// Direct GPS Reader using Node.js built-in modules
const { spawn } = require('child_process');
const EventEmitter = require('events');
const { PoseFilter } = require('./smoothing');

class DirectGPSReader extends EventEmitter {
  constructor(port, baudRate = 9600) {
    super();
    this.port = port;
    this.baudRate = baudRate;
    this.gpsProcess = null;
    this.isConnected = false;
    
    // Initialize GPS smoothing filter - OPTIMIZED FOR SPEED
    this.gpsFilter = new PoseFilter({
      preferRTK: false,
      maxHAccM: 3.0,        // 3m accuracy (relaxed for faster updates)
      deadbandM: 0.1,       // 10cm deadband (much more responsive)
      minSats: 4,           // Minimum satellites (reduced for faster updates)
      emaAlpha: 0.6,        // More responsive smoothing
      require3D: false      // Don't require 3D fix
    });
  }

  connect() {
    
    // Create a PowerShell script to read from serial port
    const script = `
      try {
        $port = New-Object System.IO.Ports.SerialPort("${this.port}", ${this.baudRate})
        $port.Open()
        Write-Output "GPS_CONNECTED"
        
        while($true) {
          try {
            $line = $port.ReadLine()
            if ($line -match "\\$G[PN]RMC|\\$G[PN]GGA") {
              Write-Output $line
            }
          } catch {
            Start-Sleep -Milliseconds 100
          }
        }
      } catch {
        Write-Error "GPS_ERROR: $_"
      } finally {
        if ($port) { $port.Close() }
      }
    `;

    this.gpsProcess = spawn('powershell', ['-Command', script]);

    this.gpsProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed === 'GPS_CONNECTED') {
          this.isConnected = true;
          this.emit('connected');
        } else if (trimmed.startsWith('$G')) {
          this.parseNMEA(trimmed);
        }
      });
    });

    this.gpsProcess.stderr.on('data', (data) => {
      const error = data.toString();
      console.error('❌ GPS Error:', error);
      if (error.includes('GPS_ERROR')) {
        this.emit('error', new Error(error));
      }
    });

    this.gpsProcess.on('close', (code) => {
      this.isConnected = false;
      this.emit('disconnect');
    });
  }

  parseNMEA(nmea) {
    try {
      const parts = nmea.split(',');
      
      if (parts[0] === '$GNRMC' || parts[0] === '$GPRMC') {
        if (parts[2] === 'A') { // Valid fix
          const lat = this.parseCoordinate(parts[3], parts[4]);
          const lng = this.parseCoordinate(parts[5], parts[6]);
          const speed = parseFloat(parts[7]) || 0;
          const course = parseFloat(parts[8]) || 0;

          // Create quality object for filtering
          const quality = {
            fixType: 3, // 3D fix (assume RMC with 'A' status is 3D)
            numSV: 10,  // Assume good satellite count
            hdop: 1.2   // Assume good HDOP
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
          const smoothed = this.gpsFilter.update(fix);
          
          if (smoothed) {
            this.emit('data', { 
              lat: smoothed.lat, 
              lng: smoothed.lon, 
              speed: speed, 
              course: course 
            });
          } else {
            // Raw data if filtering fails
            this.emit('data', { 
              lat: lat, 
              lng: lng, 
              speed: speed, 
              course: course 
            });
          }
        } else {
        }
      } else if (parts[0] === '$GNGGA' || parts[0] === '$GPGGA') {
        if (parts[6] !== '0') { // Valid fix
          const lat = this.parseCoordinate(parts[2], parts[3]);
          const lng = this.parseCoordinate(parts[4], parts[5]);
          const altitude = parseFloat(parts[9]) || 0;
          const hdop = parseFloat(parts[8]) || 0;
          const numSats = parseInt(parts[7]) || 0;

          // Create quality object for filtering
          const quality = {
            fixType: 3, // 3D fix
            numSV: numSats,
            hdop: hdop
          };

          // Create fix object for filter
          const fix = {
            lat: lat,
            lon: lng,
            speedMps: 0, // GGA doesn't have speed
            quality: quality,
            timestampMs: Date.now()
          };

          // Apply smoothing filter
          const smoothed = this.gpsFilter.update(fix);
          
          if (smoothed) {
            this.emit('data', { 
              lat: smoothed.lat, 
              lng: smoothed.lon, 
              speed: 0, 
              course: 0 
            });
          } else {
            // Raw data if filtering fails
            this.emit('data', { 
              lat: lat, 
              lng: lng, 
              speed: 0, 
              course: 0 
            });
          }
        } else {
        }
      }
    } catch (error) {
      console.warn('⚠️ Error parsing NMEA:', error);
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

  disconnect() {
    if (this.gpsProcess) {
      this.gpsProcess.kill();
      this.gpsProcess = null;
    }
    this.isConnected = false;
    this.emit('disconnect');
  }
}

module.exports = DirectGPSReader;

