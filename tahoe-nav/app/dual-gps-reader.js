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
    this.basePort = basePort;   // COM12 - Base (direction)
    
    this.roverBaudRate = roverBaudRate; // 19200 for rover
    this.baseBaudRate = baseBaudRate;   // 115200 for base
    this.roverProcess = null;
    this.baseProcess = null;
    this.roverData = null;
    this.baseData = null;
    this.isConnected = false;
    
    // Initialize GPS smoothing filters
    this.roverFilter = new PoseFilter({
      preferRTK: false,     // Set to true when RTK corrections are flowing
      maxHAccM: 1.5,        // 1.5m accuracy for indoor testing
      deadbandM: 0.3,       // 30cm deadband for "on table" hold
      minSats: 8,           // Minimum satellites for indoor
      emaAlpha: 0.3         // Slightly more responsive
    });
    
    this.baseFilter = new PoseFilter({
      preferRTK: false,
      maxHAccM: 2.0,        // Base can be less accurate
      deadbandM: 0.5,       // 50cm deadband for base
      minSats: 6,           // Base needs fewer satellites
      emaAlpha: 0.25
    });
  }

  connect() {
    console.log(`Connecting to Rover GPS on ${this.roverPort}...`);
    console.log(`Connecting to Base Station GPS on ${this.basePort}...`);
    
    this.connectRover();
    this.connectBase();
    
    // Add timeout to check if we're getting data
    setTimeout(() => {
      if (!this.roverData) {
        console.log('🔵 ⚠️ No rover data received after 10 seconds - check rover GPS connection');
      }
      if (!this.baseData) {
        console.log('🟡 ⚠️ No base data received after 10 seconds - base GPS may need satellite fix');
        console.log('💡 System will work with rover GPS only until base gets fix');
      }
    }, 10000);
  }

  connectRover() {
    try {
      this.roverSerial = new SerialPort({
        path: this.roverPort,
        baudRate: this.roverBaudRate,
        autoOpen: false,
        dataBits: 8,
        parity: 'none',
        stopBits: 1,
        flowControl: false
      });

      // Create a readline parser for the rover
      this.roverParser = this.roverSerial.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      this.roverSerial.open((err) => {
        if (err) {
          console.error('🔵 Rover GPS Error:', err.message);
          console.log('🔵 Trying alternative baud rates...');
          this.tryAlternativeBaudRates();
          return;
        }
        console.log('🔵 Rover GPS connected');
        this.emit('roverConnected', true);
      });

      // Listen for parsed lines from rover
      this.roverParser.on('data', (line) => {
        if (line.trim()) {
          // Check if line contains valid NMEA data
          if (this.isValidNMEA(line.trim())) {
            if (line.includes('RMC') || line.includes('GGA')) {
              this.parseRoverNMEA(line.trim());
            }
          } else if (this.isUbloxBinaryData(line)) {
            // Try alternative baud rates if we're getting binary data
            this.tryAlternativeBaudRates();
          } else if (this.hasValidNMEAData(line)) {
            // Extract NMEA sentences from mixed data
            const nmeaMatches = line.match(/\$[A-Z]{2}[A-Z]{3},[^*]*\*[0-9A-F]{2}/g);
            if (nmeaMatches) {
              nmeaMatches.forEach(nmea => {
                if (nmea.includes('RMC') || nmea.includes('GGA')) {
                  this.parseRoverNMEA(nmea);
                }
              });
            }
          } else {
            // If we get garbled data, try alternative baud rates
            this.tryAlternativeBaudRates();
          }
        }
      });

      this.roverSerial.on('error', (err) => {
        console.error('🔵 Rover GPS Error:', err.message);
        this.emit('roverConnected', false);
      });

      this.roverSerial.on('close', () => {
        console.log('🔵 Rover GPS disconnected');
        this.isConnected = false;
        this.emit('disconnect');
      });

    } catch (error) {
      console.error('🔵 Failed to create Rover GPS connection:', error);
      this.emit('roverConnected', false);
    }
  }

  connectBase() {
    try {
      this.baseSerial = new SerialPort({
        path: this.basePort,
        baudRate: this.baseBaudRate,
        autoOpen: false,
        dataBits: 8,
        parity: 'none',
        stopBits: 1,
        flowControl: false
      });

      // Create a readline parser for the base
      this.baseParser = this.baseSerial.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      this.baseSerial.open((err) => {
        if (err) {
          console.error('🟡 Base GPS Error:', err.message);
          this.emit('baseConnected', false);
          return;
        }
        console.log('🟡 Base GPS connected');
        this.emit('baseConnected', true);
      });

      // Listen for parsed lines from base
      this.baseParser.on('data', (line) => {
        if (line.trim()) {
          if (this.isValidNMEA(line.trim())) {
            if (line.includes('RMC') || line.includes('GGA')) {
              this.parseBaseNMEA(line.trim());
            }
          }
        }
      });

      this.baseSerial.on('error', (err) => {
        console.error('🟡 Base GPS Error:', err.message);
        this.emit('baseConnected', false);
      });

      this.baseSerial.on('close', () => {
        console.log('🟡 Base GPS disconnected');
      });

    } catch (error) {
      console.error('🟡 Failed to create Base GPS connection:', error);
      this.emit('baseConnected', false);
    }
  }

  parseRoverNMEA(nmea) {
    try {
      const parts = nmea.split(',');
      
      if (parts[0] === '$GNRMC' || parts[0] === '$GPRMC') {
        if (parts[2] === 'A') { // Valid fix
          const lat = this.parseCoordinate(parts[3], parts[4]);
          const lng = this.parseCoordinate(parts[5], parts[6]);
          const speed = parseFloat(parts[7]) || 0;
          const course = parseFloat(parts[8]) || 0;

          // Validate coordinates
          if (this.isValidCoordinate(lat, lng)) {
            // Create quality object for filtering
            const quality = {
              fixType: 3, // 3D fix (assume RMC with 'A' status is 3D)
              numSV: 12,  // Assume good satellite count for RMC
              hdop: 1.0   // Assume good HDOP for RMC with 'A' status
            };

            // Create fix object for filter
            const fix = {
              lat: lat,
              lon: lng,
              speedMps: speed * 0.514444, // Convert knots to m/s
              quality: quality,
              timestampMs: Date.now()
            };

            // Apply smoothing filter
            const smoothed = this.roverFilter.update(fix);
            
            if (smoothed) {
              // Use smoothed coordinates
              this.roverData = { 
                lat: smoothed.lat, 
                lng: smoothed.lon, 
                speed: speed, 
                course: course 
              };
              
              console.log('🔵 Rover GPS Fix (Filtered):', 
                `Lat: ${smoothed.lat.toFixed(6)}, Lng: ${smoothed.lon.toFixed(6)}, Speed: ${speed} kts, Course: ${course}°`);
              console.log('🔵 Filter Stats:', smoothed.stats);
              
              this.processRTKData();
            } else {
              console.log('🔵 Rover GPS Fix (Filtered out):', 
                `Raw: Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}, Speed: ${speed} kts`);
            }
          } else {
            console.log('🔵 ❌ Invalid GPS coordinates:', `Lat: ${lat}, Lng: ${lng}`);
          }
        }
      }
      // Emit rover connection status
      this.emit('roverConnected', true);
    } catch (error) {
      console.warn('🔵 Error parsing rover NMEA:', error);
    }
  }

  parseBaseNMEA(nmea) {
    try {
      const parts = nmea.split(',');
      
      if (parts[0] === '$GNRMC' || parts[0] === '$GPRMC') {
        if (parts[2] === 'A') { // Valid fix
          const lat = this.parseCoordinate(parts[3], parts[4]);
          const lng = this.parseCoordinate(parts[5], parts[6]);
          const speed = parseFloat(parts[7]) || 0;
          const course = parseFloat(parts[8]) || 0;

          // Validate coordinates
          if (this.isValidCoordinate(lat, lng)) {
            // Create quality object for filtering
            const quality = {
              fixType: 3, // 3D fix (assume RMC with 'A' status is 3D)
              numSV: 10,  // Assume good satellite count for base
              hdop: 1.2   // Assume good HDOP for base
            };

            // Create fix object for filter
            const fix = {
              lat: lat,
              lon: lng,
              speedMps: speed * 0.514444, // Convert knots to m/s
              quality: quality,
              timestampMs: Date.now()
            };

            // Apply smoothing filter
            const smoothed = this.baseFilter.update(fix);
            
            if (smoothed) {
              // Use smoothed coordinates
              this.baseData = { 
                lat: smoothed.lat, 
                lng: smoothed.lon, 
                speed: speed, 
                course: course 
              };
              
              console.log('🟡 Base GPS Fix (Filtered):', 
                `Lat: ${smoothed.lat.toFixed(6)}, Lng: ${smoothed.lon.toFixed(6)}, Speed: ${speed} kts, Course: ${course}°`);
              
              this.processRTKData();
            } else {
              console.log('🟡 Base GPS Fix (Filtered out):', 
                `Raw: Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}, Speed: ${speed} kts`);
            }
          } else {
            console.log('🟡 ❌ Invalid GPS coordinates:', `Lat: ${lat}, Lng: ${lng}`);
          }
        }
      }
      // Emit base connection status
      this.emit('baseConnected', true);
    } catch (error) {
      console.warn('🟡 Error parsing base NMEA:', error);
    }
  }

  parseCoordinate(coord, direction) {
    if (!coord || coord === '') return 0;
    
    // NMEA format: DDMM.MMMM for lat, DDDMM.MMMM for lng
    // Example: "3724.0010" = 37 degrees, 24.0010 minutes
    const dotIndex = coord.indexOf('.');
    if (dotIndex === -1) return 0;
    
    // For latitude: first 2 digits are degrees, rest are minutes
    // For longitude: first 3 digits are degrees, rest are minutes
    const isLongitude = direction === 'W' || direction === 'E';
    const degreesLength = isLongitude ? 3 : 2;
    
    const degrees = parseFloat(coord.substring(0, degreesLength));
    const minutes = parseFloat(coord.substring(degreesLength));
    
    const decimal = degrees + (minutes / 60);
    
    if (direction === 'S' || direction === 'W') {
      return -decimal;
    }
    return decimal;
  }

  isValidCoordinate(lat, lng) {
    // Check if coordinates are valid numbers and within valid ranges
    return !isNaN(lat) && !isNaN(lng) && 
           lat >= -90 && lat <= 90 && 
           lng >= -180 && lng <= 180 &&
           lat !== 0 && lng !== 0; // Exclude 0,0 which is often invalid
  }

  processRTKData() {
    // Work with rover data even if base doesn't have a fix
    if (this.roverData) {
      if (this.baseData) {
        // Both rover and base have data - full RTK mode
        const roverToBaseHeading = this.calculateHeading(this.roverData, this.baseData);
        const baseline = this.calculateDistance(this.roverData, this.baseData);
        
        console.log('🎯 RTK Data (Full):', `Rover-to-Base: ${roverToBaseHeading.toFixed(1)}°, Baseline: ${baseline.toFixed(2)}m, Rover Course: ${this.roverData.course.toFixed(1)}°`);
        
        const effectiveHeading = (this.roverData.course > 0 && this.roverData.course <= 360) ? 
                                this.roverData.course : roverToBaseHeading;
        
        this.emit('rtkData', {
          rover: this.roverData,
          base: this.baseData,
          heading: effectiveHeading,
          baseline: baseline
        });
      } else {
        // Only rover has data - single GPS mode with rover data
        console.log('🎯 RTK Data (Rover Only):', `Rover Course: ${this.roverData.course.toFixed(1)}°, Base: No fix`);
        
        const effectiveHeading = (this.roverData.course > 0 && this.roverData.course <= 360) ? 
                                this.roverData.course : 0;
        
        this.emit('rtkData', {
          rover: this.roverData,
          base: null,  // No base data
          heading: effectiveHeading,
          baseline: 0
        });
      }

      // Always emit regular data for rover position
      this.emit('data', this.roverData);
      
      if (!this.isConnected) {
        this.isConnected = true;
        this.emit('connected');
      }
    }
  }

  calculateHeading(rover, base) {
    const dLng = (base.lng - rover.lng) * Math.PI / 180;
    const lat1 = rover.lat * Math.PI / 180;
    const lat2 = base.lat * Math.PI / 180;
    
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    
    let heading = Math.atan2(y, x) * 180 / Math.PI;
    return (heading + 360) % 360;
  }

  calculateDistance(point1, point2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = (point2.lat - point1.lat) * Math.PI / 180;
    const dLng = (point2.lng - point1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  isValidNMEA(line) {
    // Check if line looks like valid NMEA data
    if (typeof line !== 'string') return false;
    return line.startsWith('$') && line.includes('*') && line.length > 10;
  }

  isUbloxBinaryData(data) {
    // Ublox binary messages start with 0xB5 0x62 (sync chars)
    if (Buffer.isBuffer(data)) {
      return data[0] === 0xB5 && data[1] === 0x62;
    }
    if (typeof data === 'string') {
      const buffer = Buffer.from(data, 'binary');
      return buffer[0] === 0xB5 && buffer[1] === 0x62;
    }
    return false;
  }

  hasValidNMEAData(data) {
    // Check if data contains valid NMEA sentences
    if (typeof data === 'string') {
      return data.includes('$G') && data.includes('*');
    }
    return false;
  }

  tryAlternativeBaudRates() {
    // Ublox GPS modules commonly use these baud rates
    const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800];
    let currentIndex = 0;

    const tryNextBaudRate = () => {
      if (currentIndex >= baudRates.length) {
        console.error('🔵 Failed to connect to rover at any baud rate');
        this.emit('roverConnected', false);
        return;
      }

      const baudRate = baudRates[currentIndex];
      console.log(`🔵 Trying ${baudRate} baud...`);

      if (this.roverSerial && this.roverSerial.isOpen) {
        this.roverSerial.close();
      }

      this.roverSerial = new SerialPort({
        path: this.roverPort,
        baudRate: baudRate,
        autoOpen: false,
        dataBits: 8,
        parity: 'none',
        stopBits: 1,
        flowControl: false
      });

      this.roverParser = this.roverSerial.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      this.roverSerial.open((err) => {
        if (err) {
          console.log(`🔵 Failed at ${baudRate} baud:`, err.message);
          currentIndex++;
          setTimeout(tryNextBaudRate, 1000);
          return;
        }

        console.log(`🔵 Rover connected at ${baudRate} baud`);
        this.roverBaudRate = baudRate; // Update the rover baud rate
        this.emit('roverConnected', true);
        
        // Configure Ublox to output NMEA data
        this.configureUbloxForNMEA();

        // Set up the same data handler
        this.roverParser.on('data', (line) => {
          if (line.trim()) {
            if (this.isValidNMEA(line.trim())) {
              if (line.includes('RMC') || line.includes('GGA')) {
                this.parseRoverNMEA(line.trim());
              }
            } else if (this.isUbloxBinaryData(line)) {
              // This baud rate might be correct but sending binary data
              // We'll keep this connection and wait for NMEA data
            } else if (this.hasValidNMEAData(line)) {
              // Extract NMEA sentences from mixed data
              const nmeaMatches = line.match(/\$[A-Z]{2}[A-Z]{3},[^*]*\*[0-9A-F]{2}/g);
              if (nmeaMatches) {
                nmeaMatches.forEach(nmea => {
                  if (nmea.includes('RMC') || nmea.includes('GGA')) {
                    this.parseRoverNMEA(nmea);
                  }
                });
              }
            } else {
              // If we get too much garbled data, try next baud rate
              this.garbledDataCount = (this.garbledDataCount || 0) + 1;
              if (this.garbledDataCount > 10) {
                console.log('🔵 Trying next baud rate...');
                this.garbledDataCount = 0;
                currentIndex++;
                setTimeout(tryNextBaudRate, 1000);
                return;
              }
            }
          }
        });
      });

      this.roverSerial.on('error', (err) => {
        console.error('🔵 Rover GPS Error:', err.message);
        this.emit('roverConnected', false);
      });

      this.roverSerial.on('close', () => {
        console.log('🔵 Rover GPS disconnected');
        this.isConnected = false;
        this.emit('disconnect');
      });
    };

    tryNextBaudRate();
  }

  configureUbloxForNMEA() {
    // Ublox UBX commands to enable NMEA output
    // This is a simplified approach - in production you might want to use ublox library
    setTimeout(() => {
      if (this.roverSerial && this.roverSerial.isOpen) {
        // Note: In a real implementation, you would send proper UBX binary commands
        // For now, we'll rely on the GPS already being configured for NMEA output
      }
    }, 2000);
  }

  disconnect() {
    if (this.roverParser) {
      this.roverParser.destroy();
      this.roverParser = null;
    }
    if (this.roverSerial && this.roverSerial.isOpen) {
      this.roverSerial.close();
      this.roverSerial = null;
    }
    if (this.baseParser) {
      this.baseParser.destroy();
      this.baseParser = null;
    }
    if (this.baseSerial && this.baseSerial.isOpen) {
      this.baseSerial.close();
      this.baseSerial = null;
    }
    this.isConnected = false;
    this.emit('disconnect');
  }
}

module.exports = DualGPSReader;
