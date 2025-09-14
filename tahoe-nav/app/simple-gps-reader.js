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
      
      // Create GPS instance with Johnny-Five
      this.gps = new GPS({
        port: this.port,
        baud: this.baudRate
      });

      this.gps.on('data', (data) => {
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
      });

      this.gps.on('change', (data) => {
      });

      this.gps.on('navigation', (data) => {
      });

      this.gps.on('error', (err) => {
        console.error('❌ GPS Error:', err);
        this.emit('error', err);
      });

      this.isConnected = true;
      this.emit('connected');

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

