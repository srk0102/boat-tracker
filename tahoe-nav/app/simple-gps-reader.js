// Simple GPS Reader using the existing gps.js module
const GPS = require('./gps.js');
const EventEmitter = require('events');

class SimpleGPSReader extends EventEmitter {
  constructor(port, baudRate = 9600) {
    super();
    this.port = port;
    this.baudRate = baudRate;
    this.gps = null;
    this.isConnected = false;
  }

  connect() {
    try {
      console.log(`🔍 Connecting to GPS on ${this.port} at ${this.baudRate} baud...`);
      
      // Create GPS instance with Johnny-Five
      this.gps = new GPS({
        port: this.port,
        baud: this.baudRate
      });

      this.gps.on('data', (data) => {
        console.log('📍 GPS Data:', data);
        if (data.latitude && data.longitude) {
          this.emit('data', {
            lat: data.latitude,
            lng: data.longitude,
            speed: data.speed,
            course: data.course
          });
        }
      });

      this.gps.on('sentence', (sentence) => {
        console.log('📡 GPS NMEA:', sentence);
      });

      this.gps.on('change', (data) => {
        console.log('🔄 GPS Position Changed:', data);
      });

      this.gps.on('navigation', (data) => {
        console.log('🧭 GPS Navigation:', data);
      });

      this.gps.on('error', (err) => {
        console.error('❌ GPS Error:', err);
        this.emit('error', err);
      });

      this.isConnected = true;
      this.emit('connected');
      console.log('✅ GPS connected successfully!');

    } catch (error) {
      console.error('❌ Failed to create GPS connection:', error);
      this.emit('error', error);
    }
  }

  disconnect() {
    if (this.gps) {
      this.gps.removeAllListeners();
      this.gps = null;
    }
    this.isConnected = false;
    this.emit('disconnect');
  }
}

module.exports = SimpleGPSReader;

