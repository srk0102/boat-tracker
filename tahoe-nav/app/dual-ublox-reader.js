// Dual u-blox GPS Reader for Position and Direction Determination
// Clean implementation for two u-blox GPS receivers

const EventEmitter = require('events');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

class DualUbloxReader extends EventEmitter {
  constructor(primaryPort, secondaryPort, baudRate = 9600) {
    super();
    
    this.primaryPort = primaryPort;
    this.secondaryPort = secondaryPort;
    this.baudRate = baudRate;
    
    this.primary = {
      port: null,
      parser: null,
      connected: false,
      lastData: null,
      fix: false
    };
    
    this.secondary = {
      port: null,
      parser: null,
      connected: false,
      lastData: null,
      fix: false
    };
    
    this.isConnected = false;
    console.log(`🛰️ Dual u-blox GPS Reader initialized - Primary: ${primaryPort}, Secondary: ${secondaryPort}`);
  }

  connect() {
    console.log('🔗 Connecting to dual u-blox GPS receivers...');
    
    // Connect primary GPS
    this.connectPrimary();
    
    // Connect secondary GPS
    this.connectSecondary();
  }

  connectPrimary() {
    try {
      this.primary.port = new SerialPort({
        path: this.primaryPort,
        baudRate: this.baudRate,
        autoOpen: false
      });

      this.primary.parser = this.primary.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      this.primary.port.open((err) => {
        if (err) {
          console.error(`❌ Primary GPS connection failed (${this.primaryPort}):`, err.message);
          this.emit('primary-error', err);
          return;
        }

        console.log(`✅ Primary GPS connected on ${this.primaryPort}`);
        this.primary.connected = true;
        this.emit('primary-connect');
        this.checkConnectionStatus();
      });

      this.primary.parser.on('data', (data) => {
        this.processPrimaryNMEA(data.toString().trim());
      });

      this.primary.port.on('error', (err) => {
        console.error(`❌ Primary GPS error:`, err.message);
        this.primary.connected = false;
        this.emit('primary-error', err);
        this.checkConnectionStatus();
      });

      this.primary.port.on('close', () => {
        console.log('📡 Primary GPS disconnected');
        this.primary.connected = false;
        this.emit('primary-disconnect');
        this.checkConnectionStatus();
      });

    } catch (error) {
      console.error(`❌ Primary GPS setup failed:`, error.message);
      this.emit('primary-error', error);
    }
  }

  connectSecondary() {
    try {
      this.secondary.port = new SerialPort({
        path: this.secondaryPort,
        baudRate: this.baudRate,
        autoOpen: false
      });

      this.secondary.parser = this.secondary.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      this.secondary.port.open((err) => {
        if (err) {
          console.error(`❌ Secondary GPS connection failed (${this.secondaryPort}):`, err.message);
          this.emit('secondary-error', err);
          return;
        }

        console.log(`✅ Secondary GPS connected on ${this.secondaryPort}`);
        this.secondary.connected = true;
        this.emit('secondary-connect');
        this.checkConnectionStatus();
      });

      this.secondary.parser.on('data', (data) => {
        this.processSecondaryNMEA(data.toString().trim());
      });

      this.secondary.port.on('error', (err) => {
        console.error(`❌ Secondary GPS error:`, err.message);
        this.secondary.connected = false;
        this.emit('secondary-error', err);
        this.checkConnectionStatus();
      });

      this.secondary.port.on('close', () => {
        console.log('📡 Secondary GPS disconnected');
        this.secondary.connected = false;
        this.emit('secondary-disconnect');
        this.checkConnectionStatus();
      });

    } catch (error) {
      console.error(`❌ Secondary GPS setup failed:`, error.message);
      this.emit('secondary-error', error);
    }
  }

  processPrimaryNMEA(sentence) {
    try {
      const data = this.parseNMEA(sentence);
      if (data) {
        this.primary.lastData = data;
        this.primary.fix = data.fix;
        this.emitDualData();
      }
    } catch (error) {
      console.error('Primary NMEA parsing error:', error.message);
    }
  }

  processSecondaryNMEA(sentence) {
    try {
      const data = this.parseNMEA(sentence);
      if (data) {
        this.secondary.lastData = data;
        this.secondary.fix = data.fix;
        this.emitDualData();
      }
    } catch (error) {
      console.error('Secondary NMEA parsing error:', error.message);
    }
  }

  parseNMEA(sentence) {
    if (!sentence.startsWith('$')) return null;

    const parts = sentence.split(',');
    const msgType = parts[0];

    // Parse GGA (Global Positioning System Fix Data)
    if (msgType.endsWith('GGA')) {
      const fixQuality = parseInt(parts[6]) || 0;
      if (fixQuality === 0) return null; // No fix

      const lat = this.parseCoordinate(parts[2], parts[3]);
      const lng = this.parseCoordinate(parts[4], parts[5]);
      const altitude = parseFloat(parts[9]) || 0;
      const satellites = parseInt(parts[7]) || 0;
      const hdop = parseFloat(parts[8]) || 99.9;

      return {
        type: 'GGA',
        lat: lat,
        lng: lng,
        altitude: altitude,
        satellites: satellites,
        hdop: hdop,
        fix: fixQuality > 0,
        fixQuality: fixQuality,
        timestamp: new Date()
      };
    }

    // Parse RMC (Recommended Minimum Course)
    if (msgType.endsWith('RMC')) {
      const status = parts[2];
      if (status !== 'A') return null; // Not active

      const lat = this.parseCoordinate(parts[3], parts[4]);
      const lng = this.parseCoordinate(parts[5], parts[6]);
      const speed = parseFloat(parts[7]) || 0; // knots
      const course = parseFloat(parts[8]) || 0; // degrees

      return {
        type: 'RMC',
        lat: lat,
        lng: lng,
        speed: speed,
        course: course,
        fix: true,
        timestamp: new Date()
      };
    }

    return null;
  }

  parseCoordinate(coord, direction) {
    if (!coord || !direction) return 0;
    
    const degrees = Math.floor(parseFloat(coord) / 100);
    const minutes = parseFloat(coord) % 100;
    let decimal = degrees + minutes / 60;
    
    if (direction === 'S' || direction === 'W') {
      decimal = -decimal;
    }
    
    return decimal;
  }

  emitDualData() {
    // Emit individual GPS data
    if (this.primary.lastData) {
      this.emit('primary-data', this.primary.lastData);
    }
    
    if (this.secondary.lastData) {
      this.emit('secondary-data', this.secondary.lastData);
    }

    // Emit combined dual GPS data
    if (this.primary.lastData && this.secondary.lastData) {
      this.emit('dual-data', {
        primary: this.primary.lastData,
        secondary: this.secondary.lastData,
        timestamp: new Date()
      });
    }
  }

  checkConnectionStatus() {
    const wasConnected = this.isConnected;
    this.isConnected = this.primary.connected && this.secondary.connected;
    
    if (this.isConnected && !wasConnected) {
      console.log('✅ Dual GPS system connected');
      this.emit('connect');
    } else if (!this.isConnected && wasConnected) {
      console.log('❌ Dual GPS system disconnected');
      this.emit('disconnect');
    }
  }

  getStatus() {
    return {
      primary: {
        connected: this.primary.connected,
        fix: this.primary.fix,
        lastData: this.primary.lastData
      },
      secondary: {
        connected: this.secondary.connected,
        fix: this.secondary.fix,
        lastData: this.secondary.lastData
      },
      isConnected: this.isConnected
    };
  }

  disconnect() {
    console.log('🔌 Disconnecting dual GPS system...');
    
    if (this.primary.port && this.primary.port.isOpen) {
      this.primary.port.close();
    }
    
    if (this.secondary.port && this.secondary.port.isOpen) {
      this.secondary.port.close();
    }
    
    this.isConnected = false;
    this.primary.connected = false;
    this.secondary.connected = false;
  }
}

module.exports = DualUbloxReader;
