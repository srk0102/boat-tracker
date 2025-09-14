// GPS Position Smoothing Filter
// Professional-grade filtering to eliminate GPS jitter and drift
const haversine = require('haversine');

// Configurable thresholds for different scenarios
const CFG = {
  minSats: 10,          // for NMEA/GGA - minimum satellites
  maxHdop: 1.8,         // for NMEA/HDOP - maximum horizontal dilution of precision
  maxHAccM: 1.5,        // for UBX hAcc (meters) - maximum horizontal accuracy
  require3D: true,      // fixType >= 3 - require 3D fix
  preferRTK: false,     // set true if you want FLOAT/FIX only
  deadbandM: 0.5,       // don't move marker unless > deadband
  emaAlpha: 0.25,       // EMA smoothing factor
  windowSize: 7,        // median window size
  minSpeedMps: 0.05,    // ignore jitter speeds below this
};

class PoseFilter {
  constructor(cfg = {}) {
    this.cfg = { ...CFG, ...cfg };
    this.buf = [];           // recent accepted raw points for median: [{lat,lon}]
    this.ema = null;         // {lat, lon} - exponential moving average
    this.lastEmit = null;    // last emitted point
    this.lastTime = null;    // timestamp of last good fix (ms)
    this.stats = {
      totalUpdates: 0,
      qualityRejected: 0,
      deadbandRejected: 0,
      speedRejected: 0,
      accepted: 0
    };
  }

  // Utility distance in meters
  static dist(a, b) {
    return haversine(
      { latitude: a.lat, longitude: a.lon },
      { latitude: b.lat, longitude: b.lon },
      { unit: 'meter' }
    );
  }

  // Sliding median of coords (component-wise) - robust against outliers
  median(latlons) {
    const med = arr => {
      const s = [...arr].sort((x, y) => x - y);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    return {
      lat: med(latlons.map(p => p.lat)),
      lon: med(latlons.map(p => p.lon)),
    };
  }

  // Quality gate - works with either UBX or NMEA fields
  passesQuality(q) {
    // q may include: fixType, carrSoln, hAcc, numSV, hdop
    if (this.cfg.require3D && q.fixType != null && q.fixType < 3) return false;
    if (this.cfg.preferRTK && q.carrSoln != null && q.carrSoln === 0) return false;
    if (q.hAcc != null && q.hAcc > this.cfg.maxHAccM) return false;
    if (q.hdop != null && q.hdop > this.cfg.maxHdop) return false;
    if (q.numSV != null && q.numSV < this.cfg.minSats) return false;
    return true;
  }

  // Main entry: feed a fix {lat, lon, speedMps?, quality: {...}, timestampMs?}
  update(fix) {
    this.stats.totalUpdates++;
    const { lat, lon, speedMps = 0, quality = {}, timestampMs = Date.now() } = fix;

    // 1) Quality gate
    if (!this.passesQuality(quality)) {
      this.stats.qualityRejected++;
      return null;
    }

    // 2) Speed sanity (ignore micro jitter)
    if (speedMps < this.cfg.minSpeedMps && this.lastEmit) {
      const distFromLast = PoseFilter.dist(this.lastEmit, { lat, lon });
      if (distFromLast < this.cfg.deadbandM) {
        this.stats.speedRejected++;
        return null;
      }
    }

    // 3) Add to buffer and compute a median point (robust against outliers)
    this.buf.push({ lat, lon });
    if (this.buf.length > this.cfg.windowSize) this.buf.shift();

    const med = this.median(this.buf);

    // 4) EMA smoothing on top of median
    if (!this.ema) {
      this.ema = { ...med };
    } else {
      this.ema.lat = this.ema.lat + this.cfg.emaAlpha * (med.lat - this.ema.lat);
      this.ema.lon = this.ema.lon + this.cfg.emaAlpha * (med.lon - this.ema.lon);
    }

    // 5) Deadband against last emitted pose
    if (this.lastEmit) {
      const d = PoseFilter.dist(this.lastEmit, this.ema);
      if (d < this.cfg.deadbandM) {
        this.stats.deadbandRejected++;
        return null;
      }
    }

    // 6) Emit smoothed pose
    this.lastEmit = { ...this.ema };
    this.lastTime = timestampMs;
    this.stats.accepted++;
    
    return { 
      lat: this.ema.lat, 
      lon: this.ema.lon,
      accuracy: quality.hAcc || quality.hdop || null,
      timestamp: timestampMs,
      stats: this.getStats()
    };
  }

  // Get filter statistics for debugging
  getStats() {
    return {
      ...this.stats,
      acceptanceRate: this.stats.totalUpdates > 0 ? 
        (this.stats.accepted / this.stats.totalUpdates * 100).toFixed(1) + '%' : '0%',
      bufferSize: this.buf.length
    };
  }

  // Reset filter state
  reset() {
    this.buf = [];
    this.ema = null;
    this.lastEmit = null;
    this.lastTime = null;
    this.stats = {
      totalUpdates: 0,
      qualityRejected: 0,
      deadbandRejected: 0,
      speedRejected: 0,
      accepted: 0
    };
  }
}

module.exports = { PoseFilter };
