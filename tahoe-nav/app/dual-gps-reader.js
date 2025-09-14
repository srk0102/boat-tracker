// Dual GPS Reader for Rover-Base RTK Setup
// COM7 = Rover (position)
// COM12 = Base Station (moving base on boat, gives direction)
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const EventEmitter = require('events');
const { PoseFilter } = require('./smoothing');

class DualGPSReader extends EventEmitter {
  constructor(roverPort, basePort, roverBaudRate = 19200, baseBaudRate = 115200) {
    super();
    this.roverPort = roverPort; // COM7 - Rover (position)
    this.basePort  = basePort;  // COM12 - Base (direction)

    this.roverBaudRate = roverBaudRate; // 19200 for rover
    this.baseBaudRate  = baseBaudRate;  // 115200 for base

    this.roverSerial = null;
    this.baseSerial  = null;
    this.roverParser = null;
    this.baseParser  = null;

    this.roverData = null; // {lat,lng,speed,course}
    this.baseData  = null; // {lat,lng,speed,course}
    this.isConnected = false;

    // Smoothing filters
    this.roverFilter = new PoseFilter({
      preferRTK: false,
      maxHAccM: 3.0,
      deadbandM: 0.1,
      minSats: 4,
      emaAlpha: 0.6,
      require3D: false
    });

    this.baseFilter = new PoseFilter({
      preferRTK: false,
      maxHAccM: 4.0,
      deadbandM: 0.2,
      minSats: 4,
      emaAlpha: 0.5,
      require3D: false
    });
  }

  connect() {
    this.connectRover();
    this.connectBase();

    setTimeout(() => {
      if (!this.roverData) {
        console.warn('🔵 Rover: no data within 10s');
      }
      if (!this.baseData) {
        console.warn('🟡 Base: no data within 10s');
      }
    }, 10000);
  }

  // ---------- serial wiring ----------
  connectRover() {
    try {
      this.roverSerial = new SerialPort({
        path: this.roverPort,
        baudRate: this.roverBaudRate,
        autoOpen: false,
        dataBits: 8, parity: 'none', stopBits: 1, flowControl: false
      });
      this.roverParser = this.roverSerial.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      this.roverSerial.open(err => {
        if (err) {
          console.error('🔵 Rover GPS Error:', err.message);
          this.tryAlternativeBaudRates();
          return;
        }
        this.emit('roverConnected', true);
      });

      this.roverParser.on('data', (line) => {
        const s = (line || '').trim();
        if (!s) return;

        if (!this.isValidNMEA(s)) {
          if (this.isUbloxBinaryData(s)) this.tryAlternativeBaudRates();
          return;
        }

        const talker = s.slice(0,6); // $GPRMC / $GPGGA / $GNRMC / $GNGGA
        if (talker.endsWith('RMC')) {
          this.parseRMC(s, 'rover');
        } else if (talker.endsWith('GGA')) {
          this.parseGGA(s, 'rover');
        }
      });

      this.roverSerial.on('error', err => {
        console.error('🔵 Rover GPS Error:', err.message);
        this.emit('roverConnected', false);
      });
      this.roverSerial.on('close', () => {
        this.isConnected = false;
        this.emit('disconnect');
      });

    } catch (e) {
      console.error('🔵 Failed to create Rover GPS connection:', e);
      this.emit('roverConnected', false);
    }
  }

  connectBase() {
    try {
      this.baseSerial = new SerialPort({
        path: this.basePort,
        baudRate: this.baseBaudRate,
        autoOpen: false,
        dataBits: 8, parity: 'none', stopBits: 1, flowControl: false
      });
      this.baseParser = this.baseSerial.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      this.baseSerial.open(err => {
        if (err) {
          console.error('🟡 Base GPS Error:', err.message);
          this.emit('baseConnected', false);
          return;
        }
        this.emit('baseConnected', true);
      });

      this.baseParser.on('data', (line) => {
        const s = (line || '').trim();
        if (!s) return;
        if (!this.isValidNMEA(s)) return;

        const talker = s.slice(0,6);
        if (talker.endsWith('RMC')) {
          this.parseRMC(s, 'base');
        } else if (talker.endsWith('GGA')) {
          this.parseGGA(s, 'base');
        }
      });

      this.baseSerial.on('error', err => {
        console.error('🟡 Base GPS Error:', err.message);
        this.emit('baseConnected', false);
      });

    } catch (e) {
      console.error('🟡 Failed to create Base GPS connection:', e);
      this.emit('baseConnected', false);
    }
  }

  // ---------- NMEA parsing ----------
  parseRMC(nmea, which) {
    try {
      const p = nmea.split(',');
      if (p.length < 12) return;
      if (p[2] !== 'A') return; // valid

      const lat   = this.parseCoordinate(p[3], p[4]);
      const lng   = this.parseCoordinate(p[5], p[6]);
      const speed = parseFloat(p[7]) || 0;   // knots
      const course= parseFloat(p[8]) || 0;   // degrees

      if (!this.isValidCoordinate(lat, lng)) return;

      const fix = {
        lat, lon: lng,
        speedMps: speed * 0.514444,
        quality: { fixType: 3, numSV: 12, hdop: 1.0 },
        timestampMs: Date.now()
      };
      const filt = (which === 'rover' ? this.roverFilter : this.baseFilter).update(fix);
      if (!filt) return;

      const obj = { lat: filt.lat, lng: filt.lon, speed, course };
      if (which === 'rover') this.roverData = obj; else this.baseData = obj;

      this.processRTKData();
    } catch (e) {
      console.warn(`❗ Error parsing ${which} RMC:`, e);
    }
  }

  // GGA has position & fix quality, no speed/course
  parseGGA(nmea, which) {
    try {
      const p = nmea.split(',');
      if (p.length < 10) return;

      const fixQ = parseInt(p[6],10) || 0; // 0=no fix
      if (fixQ === 0) return;

      const lat   = this.parseCoordinate(p[2], p[3]);
      const lng   = this.parseCoordinate(p[4], p[5]);
      const numSV = parseInt(p[7],10) || 0;
      const hdop  = parseFloat(p[8]) || 99;

      if (!this.isValidCoordinate(lat, lng)) return;

      const fix = {
        lat, lon: lng,
        speedMps: 0,
        quality: { fixType: fixQ >= 4 ? 4 : 3, numSV, hdop },
        timestampMs: Date.now()
      };
      const filt = (which === 'rover' ? this.roverFilter : this.baseFilter).update(fix);
      if (!filt) return;

      const obj = { lat: filt.lat, lng: filt.lon, speed: 0, course: 0 };
      if (which === 'rover') this.roverData = obj; else this.baseData = obj;

      this.processRTKData();
    } catch (e) {
      console.warn(`❗ Error parsing ${which} GGA:`, e);
    }
  }

  parseCoordinate(coord, direction) {
    if (!coord) return 0;
    const dot = coord.indexOf('.');
    if (dot === -1) return 0;

    const isLon = (direction === 'E' || direction === 'W');
    const degLen = isLon ? 3 : 2;

    const deg = parseFloat(coord.substring(0, degLen));
    const min = parseFloat(coord.substring(degLen));
    if (Number.isNaN(deg) || Number.isNaN(min)) return 0;

    let dec = deg + (min / 60);
    if (direction === 'S' || direction === 'W') dec = -dec;
    return dec;
  }

  isValidCoordinate(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) &&
           lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
           !(lat === 0 && lng === 0);
  }

  // ---------- fusion & yaw ----------
  processRTKData() {
    if (!this.roverData) return;

    // Always emit rover position
    this.emit('data', this.roverData);

    let heading = 0;
    let hasRTKHeading = false;
    let baseline = 0;

    if (this.baseData) {
      // meters between antennas
      baseline = this.calculateDistance(this.baseData, this.roverData);
      const MIN_BASELINE_M = 0.8; // (use 0.4 just for driveway tests)

      if (baseline >= MIN_BASELINE_M) {
        // TRUE yaw: BASE -> ROVER
        heading = this.calculateBearing(this.baseData, this.roverData);
        hasRTKHeading = true;
      }
    }

    if (!hasRTKHeading) {
      const c = this.roverData.course;
      heading = (c > 0 && c <= 360) ? c : 0;
    }

    // Debug
    try {
      console.log('[RTK]', {
        baseline_m: +baseline.toFixed(2),
        heading_deg: +heading.toFixed(1),
        hasRTKHeading
      });
    } catch (_){}

    this.emit('rtkData', {
      rover: this.roverData,
      base:  this.baseData || null,
      heading,
      baseline,
      hasRTKHeading
    });

    if (!this.isConnected) {
      this.isConnected = true;
      this.emit('connected');
    }
  }

  // Bearing from 'from' -> 'to' (0°=North, clockwise)
  calculateBearing(from, to) {
    const φ1 = from.lat * Math.PI / 180;
    const φ2 =   to.lat * Math.PI / 180;
    const Δλ = (to.lng - from.lng) * Math.PI / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
              Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    let brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
  }

  calculateDistance(a, b) {
    const R = 6371000;
    const φ1 = a.lat * Math.PI/180;
    const φ2 = b.lat * Math.PI/180;
    const Δφ = (b.lat - a.lat) * Math.PI/180;
    const Δλ = (b.lng - a.lng) * Math.PI/180;

    const sin = Math.sin;
    const cos = Math.cos;

    const h = sin(Δφ/2)**2 + cos(φ1)*cos(φ2)*sin(Δλ/2)**2;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
  }

  // ---------- helpers ----------
  isValidNMEA(line) {
    return typeof line === 'string' && line.startsWith('$') && line.includes('*') && line.length > 10;
  }

  isUbloxBinaryData(data) {
    if (Buffer.isBuffer(data)) return data[0] === 0xB5 && data[1] === 0x62;
    if (typeof data === 'string' && data.length >= 2) {
      const buf = Buffer.from(data, 'binary');
      return buf[0] === 0xB5 && buf[1] === 0x62;
    }
    return false;
  }

  hasValidNMEAData(s) {
    return typeof s === 'string' && s.includes('$G') && s.includes('*');
  }

  tryAlternativeBaudRates() {
    const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800];
    let idx = 0;

    const tryNext = () => {
      if (idx >= baudRates.length) {
        console.error('🔵 Failed to connect to rover at any baud rate');
        this.emit('roverConnected', false);
        return;
      }

      const rate = baudRates[idx++];

      if (this.roverSerial && this.roverSerial.isOpen) {
        this.roverSerial.close();
      }

      this.roverSerial = new SerialPort({
        path: this.roverPort,
        baudRate: rate,
        autoOpen: false,
        dataBits: 8, parity: 'none', stopBits: 1, flowControl: false
      });
      this.roverParser = this.roverSerial.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      this.roverSerial.open(err => {
        if (err) {
          setTimeout(tryNext, 1000);
          return;
        }

        this.roverBaudRate = rate;
        this.emit('roverConnected', true);
        this.configureUbloxForNMEA();

        this.roverParser.on('data', (line) => {
          const s = (line || '').trim();
          if (!s) return;
          if (!this.isValidNMEA(s)) return;

          const talker = s.slice(0,6);
          if (talker.endsWith('RMC')) this.parseRMC(s, 'rover');
          else if (talker.endsWith('GGA')) this.parseGGA(s, 'rover');
        });
      });

      this.roverSerial.on('error', err => {
        console.error('🔵 Rover GPS Error:', err.message);
        this.emit('roverConnected', false);
      });
      this.roverSerial.on('close', () => {
        this.isConnected = false;
        this.emit('disconnect');
      });
    };

    tryNext();
  }

  configureUbloxForNMEA() {
    // Placeholder for UBX config if needed.
  }

  disconnect() {
    try { this.roverParser?.destroy(); } catch(_){}
    try { this.roverSerial?.isOpen && this.roverSerial.close(); } catch(_){}
    try { this.baseParser?.destroy(); } catch(_){}
    try { this.baseSerial?.isOpen  && this.baseSerial.close(); } catch(_){}
    this.isConnected = false;
    this.emit('disconnect');
  }
}

module.exports = DualGPSReader;
