/*
 * index.js - Google Maps Version
 * Main project logic with Google Maps integration
 */

// Boilerplate to fix electron/johnny-five/serialport interaction
var Readable = require("stream").Readable;
var util = require("util");
util.inherits(MyStream, Readable);
function MyStream(opt) {
  Readable.call(this, opt);
}
MyStream.prototype._read = function () {};

Object.defineProperty(process, "stdin", function () {
  if (process.__stdin) return process.__stdin;
  process.__stdin = new MyStream();
  return process.__stdin;
});
// End boilerplate

// Set up logging
const moment = require("moment");
const fs = require("fs");
const applog = require("electron-log");
const navlog = applog.create("anotherInstance");
applog.transports.file.file = "app.log";
navlog.transports.file.file = moment().format("MMM-DD-YYYY") + ".log";
navlog.transports.console.level = false;
navlog.transports.file.maxSize = 0; // Disable log rollover to prevent overwriting
applog.info("App Started");

// Set up JSON config
let rawdata = fs.readFileSync("./config.json");
let configdata = JSON.parse(rawdata);

// Make config data globally accessible
window.configdata = configdata;

// Load Google Maps API
const googleMapsScript = document.createElement("script");
googleMapsScript.type = "text/javascript";
googleMapsScript.async = true;
googleMapsScript.defer = true;
googleMapsScript.src = `https://maps.googleapis.com/maps/api/js?key=${configdata.mapsApiKey}&libraries=geometry,marker&callback=initGoogleMap`;
googleMapsScript.onerror = () => {
  console.error('❌ Google Maps API failed to load');
  const mapElement = document.getElementById("map");
  if (mapElement) {
    mapElement.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; background: #f0f0f0; color: #666; font-family: Arial, sans-serif;"><div style="text-align: center;"><h3>🗺️ Map Loading Error</h3><p>Google Maps API failed to load. Please check your internet connection and API key.</p><p>API Key: ' + configdata.mapsApiKey.substring(0, 10) + '...</p></div></div>';
  }
};
document.getElementsByTagName("head")[0].appendChild(googleMapsScript);

// Import Google Maps implementation
const { initMap, isMapReady, updateVesselPosition, clearVesselBoxes, updateVesselBox, loadBoatDimensions, getSailingStatus, clearBoatPath, resumePathCreation, setVesselCreationDistance, getVesselCreationDistance } = require('./google-maps-implementation.js');

// Load boat dimensions from config
loadBoatDimensions(configdata);

// Make initMap globally accessible
window.initGoogleMap = initMap;

// Import functions
const { updateDistTable, deleteMarkers } = require("./sidebarMAN");
const { setSidebarContents } = require("./sidebar");

// Data for gps distance
const haversine = require("haversine");
const convert = require("convert-units");
var disttableheader = ["", "Lat.", "Lon.", 	"\u0394Lat. (ft)", "\u0394Lon. (ft)", "Dist.(ft)"];
var disttabledata = [["Curr. Pos.", "", "", "0", "0", 0]];

// Global variables (map, vessel, vesselBoxes are managed by google-maps-implementation.js)
var markers = []; // Markers for distance points
var zone; // Treatment zone polygon
var zonepath;
var path; // Generated treatment path
var trackedPath; // Path where vessel has already been
var marker; // Close poly marker
var settingZoneState = "init";
var settingPath = false;
var zoneSelected = false;

// isMapReady function is imported from google-maps-implementation.js

// GPS filtering and movement detection
var lastValidPos = null;
var lastUpdateTime = 0;
var positionHistory = [];
var isMoving = false;
var movementThreshold = 1.0; // meters - reduced for better responsiveness
var timeThreshold = 500; // milliseconds - reduced for faster updates
var minAccuracy = 15.0; // meters - more lenient for testing

// Dual GPS Setup - COM7 as rover, COM12 as base
var gpsReader = null;
var vesselHeading = 0;
var roverConnected = false;
var baseConnected = false;
var lastRoverStatus = null; // Track last rover connection status
var lastBaseStatus = null; // Track last base connection status

// Initialize GPS reader
function initGPSReader() {
  try {
    if (configdata.useRoverBase) {
      const DualGPSReader = require('./dual-gps-reader.js');
      gpsReader = new DualGPSReader(configdata.gpsPort, configdata.baseStationPort, 19200, 115200);
    } else {
      const SimpleGPSReader = require('./simple-gps-reader.js');
      gpsReader = new SimpleGPSReader(configdata.gpsPort, 9600); // Try 9600 baud first
    }

    gpsReader.on('data', (data) => {
      console.log('📍 GPS Data received:', {
        lat: data.lat ? data.lat.toFixed(6) : 'No data',
        lng: data.lng ? data.lng.toFixed(6) : 'No data',
        speed: data.speed || 0,
        course: data.course || 0,
        accuracy: data.accuracy || 'Unknown'
      });
      
      if (data.lat && data.lng) {
        const newPos = { lat: data.lat, lng: data.lng };
        const accuracy = data.accuracy || 5.0; // Assume 5m accuracy if not provided
        const speed = data.speed || 0; // Speed in knots
        const course = data.course || 0; // Course in degrees
        
        // Filter GPS data to prevent drift
        if (shouldUpdatePosition(newPos, accuracy)) {
          pos = newPos;
          
          // Priority for heading calculation:
          // 1. Use GPS course if available and valid
          // 2. Calculate from movement if moving
          if (course > 0 && course <= 360) {
            vesselHeading = course;
          } else if (lastValidPos && isMoving) {
            // Calculate heading from position changes when moving
            vesselHeading = computeHeading(lastValidPos, pos);
          }
          
          hasFix = true;
          updateVesselState(pos, speed, accuracy);
          
          
          // Update vessel position and rotation on map if map is ready
          if (isMapReady()) {
            updateVesselPosition(pos.lat, pos.lng, vesselHeading, centerOnPos);
          }
        } else {
        }
      } else {
      }
    });

    gpsReader.on('rtkData', (data) => {
      if (data.rover) {
        console.log('🔵 Rover GPS Data:', {
          lat: data.rover.lat ? data.rover.lat.toFixed(6) : 'No data',
          lng: data.rover.lng ? data.rover.lng.toFixed(6) : 'No data',
          speed: data.rover.speed || 0,
          course: data.rover.course || 0
        });
      }
      
      if (data.base) {
        console.log('🟡 Base GPS Data:', {
          lat: data.base.lat ? data.base.lat.toFixed(6) : 'No data',
          lng: data.base.lng ? data.base.lng.toFixed(6) : 'No data',
          speed: data.base.speed || 0,
          course: data.base.course || 0
        });
      }
      
      if (data.rover && data.rover.lat && data.rover.lng) {
        const newPos = { lat: data.rover.lat, lng: data.rover.lng };
        const accuracy = 1.0; // RTK typically has 1m accuracy
        const speed = data.rover.speed || 0;
        const course = data.rover.course || 0; // Get course from rover GPS data
        
        // Always update position for RTK (very accurate)
        pos = newPos;
        
        // Priority for heading calculation:
        // 1. Use RTK calculated heading (rover to base vector) - this is working in your logs
        // 2. Use GPS course from rover if available and valid (but yours is always 0°)
        // 3. Calculate from movement if moving
        if (data.heading !== undefined && data.heading >= 0 && data.heading <= 360) {
          vesselHeading = data.heading;
        } else if (course > 0 && course <= 360) {
          vesselHeading = course;
        } else if (lastValidPos && isMoving) {
          vesselHeading = computeHeading(lastValidPos, pos);
        }
        
        hasFix = true;
        updateVesselState(pos, speed, accuracy);
        
        
        // Update vessel position and rotation on map if map is ready
        if (isMapReady()) {
          updateVesselPosition(pos.lat, pos.lng, vesselHeading, centerOnPos);
        }
      } else {
      }
    });

    gpsReader.on('roverConnected', (connected) => {
      roverConnected = connected;
      // Only log when status actually changes
      if (lastRoverStatus !== connected) {
        console.log('🔵 Rover GPS Connection:', connected ? 'CONNECTED' : 'DISCONNECTED');
        lastRoverStatus = connected;
      }
      updateGPSStatus();
    });

    gpsReader.on('baseConnected', (connected) => {
      baseConnected = connected;
      // Only log when status actually changes
      if (lastBaseStatus !== connected) {
        console.log('🟡 Base GPS Connection:', connected ? 'CONNECTED' : 'DISCONNECTED');
        lastBaseStatus = connected;
      }
      updateGPSStatus();
    });

    gpsReader.on('error', (error) => {
      // GPS Error occurred
    });

    gpsReader.on('disconnect', () => {
      console.log('GPS disconnected');
      hasFix = false;
      roverConnected = false;
      baseConnected = false;
      lastRoverStatus = false; // Reset status tracking
      lastBaseStatus = false; // Reset status tracking
      updateGPSStatus();
    });

    gpsReader.connect();
    
  } catch (error) {
    console.error('Failed to initialize GPS reader:', error);
  }
}

// Update GPS status display
function updateGPSStatus() {
  const gpsInfo = document.getElementById('gps-info');
  if (gpsInfo) {
    let statusText = 'GPS: ';
    
    if (roverConnected && baseConnected) {
      statusText += 'Rover ✓ Base ✓ | RTK: Ready';
    } else if (roverConnected) {
      statusText += 'Rover ✓ Base ✗ | Single GPS';
    } else if (baseConnected) {
      statusText += 'Rover ✗ Base ✓ | Single GPS';
    } else {
      statusText += 'Connecting...';
    }
    
    gpsInfo.textContent = statusText;
  }
}

// GPS filtering and movement detection functions
function calculateDistance(pos1, pos2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (pos2.lat - pos1.lat) * Math.PI / 180;
  const dLng = (pos2.lng - pos1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(pos1.lat * Math.PI / 180) * Math.cos(pos2.lat * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function isGPSDataValid(newPos, accuracy = 10.0) {
  // Filter out invalid GPS data
  if (!newPos || !newPos.lat || !newPos.lng) return false;
  if (isNaN(newPos.lat) || isNaN(newPos.lng)) return false;
  if (newPos.lat === 0 && newPos.lng === 0) return false; // Invalid coordinates
  
  // Check if coordinates are within valid ranges
  if (newPos.lat < -90 || newPos.lat > 90) return false;
  if (newPos.lng < -180 || newPos.lng > 180) return false;
  
  // Check accuracy if provided
  if (accuracy > minAccuracy) return false;
  
  return true;
}

function shouldUpdatePosition(newPos, accuracy = 10.0) {
  const now = Date.now();
  
  // Always update if we don't have a valid position
  if (!lastValidPos) {
    return true;
  }
  
  // Check if enough time has passed
  if (now - lastUpdateTime < timeThreshold) {
    return false;
  }
  
  // Check if GPS data is valid
  if (!isGPSDataValid(newPos, accuracy)) {
    return false;
  }
  
  // Calculate distance from last valid position
  const distance = calculateDistance(lastValidPos, newPos);
  
  // Update if moving significantly or if position seems stable
  return distance >= movementThreshold;
}

function updateVesselState(newPos, speed = 0, accuracy = 10.0) {
  const now = Date.now();
  
  // Update movement state
  if (speed > 0.5) { // Moving if speed > 0.5 knots
    isMoving = true;
  } else if (lastValidPos) {
    const distance = calculateDistance(lastValidPos, newPos);
    const timeSinceLastUpdate = now - lastUpdateTime;
    const calculatedSpeed = distance / (timeSinceLastUpdate / 1000); // m/s
    
    // Consider stopped if speed < 0.2 m/s (about 0.4 knots)
    isMoving = calculatedSpeed > 0.2;
  }
  
  // Update position history for smoothing
  positionHistory.push({ pos: newPos, time: now });
  if (positionHistory.length > 10) {
    positionHistory.shift(); // Keep only last 10 positions
  }
  
  lastValidPos = newPos;
  lastUpdateTime = now;
}

// Geometry helper functions
function computeHeading(from, to) {
  // Calculate bearing between two points
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  
  let heading = Math.atan2(y, x) * 180 / Math.PI;
  return (heading + 360) % 360;
}

// UI Elements
var buttonModeMan = document.getElementById("button-mode-man");
var buttonModeGPS = document.getElementById("button-mode-gps");
var buttonModeCfg = document.getElementById("button-mode-cfg");
var buttons = document.getElementsByClassName("disabled");
var boardstatus = document.getElementById("board-status");
var clock = document.getElementById("clock");
var trackingstatus = document.getElementById("tracking-status");

var isManual;
var pos = null; // Initialize pos as null
var isTracking = false;
// Make isTracking globally accessible for sidebar
window.isTracking = isTracking;

// Make clearing functions globally accessible for sidebar
window.clearBoatPath = clearBoatPath;
window.clearVesselBoxes = clearVesselBoxes;

// Make distance table data globally accessible
window.disttabledata = disttabledata;

// Make deleteMarkers function globally accessible
window.deleteMarkers = deleteMarkers;

// Make resumePathCreation function globally accessible
window.resumePathCreation = resumePathCreation;

// Make suppressPathCreation globally accessible
window.suppressPathCreation = false;

// Make vessel creation distance functions globally accessible
window.setVesselCreationDistance = setVesselCreationDistance;
window.getVesselCreationDistance = getVesselCreationDistance;

var trackedPos = [];
var hasFix = false;
var lastLogged;
var startLog;
var centerOnPos = true;

boardstatus.innerHTML = "No Arduino Connected (not required)";

function loop() {
  setTimeout(() => {
    // Current time
    clock.innerHTML = moment().format("h:mm:ss a");

    // Update tracking timer
    if (isTracking) {
      duration = moment() - startLog;
      var seconds = parseInt((duration / 1000) % 60);
      var minutes = parseInt((duration / (1000 * 60)) % 60);
      var hours = parseInt((duration / (1000 * 60 * 60)) % 24);

      hours = hours < 10 ? "0" + hours : hours;
      minutes = minutes < 10 ? "0" + minutes : minutes;
      seconds = seconds < 10 ? "0" + seconds : seconds;

      trackingstatus.innerHTML = hours + ":" + minutes + ":" + seconds;
    } else {
      trackingstatus.innerHTML = "";
    }

    // GPS Fix - Update vessel marker appearance
    if (hasFix && pos) {
      // Update vessel position and rotation on map (position updates are handled in GPS handlers)
      if (isMapReady()) {
        updateVesselPosition(pos.lat, pos.lng, vesselHeading, centerOnPos);
      }
      
      // Update vessel state for movement detection
      updateVesselState(pos, 0); // Speed will be calculated from position changes
    } else {
    }

    // Update gps distance table, if it exists
    if (hasFix && document.getElementById("coord-table-container")) {
      updateDistTable(); // TODO: check performance, might be updating too often
    }

    // Logging conditions
    if (hasFix && isTracking && moment() - lastLogged > 500) {
      // Fix established and currently tracking and last recorded coordinate was > 2s ago
      navlog.info(pos);
      trackedPos.push(pos);
      lastLogged = moment();
    } else if (!hasFix && pos && pos.lat) {
      // Fix just established
      hasFix = true;
      navlog.info("GNSS Fix established");
    }

    // Map centering is now handled in updateVesselPosition

    loop();
  }, 50); // Reduced from 100ms to 50ms for faster updates (20 times per second)
}

// One-time setup
buttonModeMan.addEventListener("click", function () {
  isManual = true;
  setSidebarContents("man");
  buttonModeMan.classList.add("active");
  buttonModeGPS.classList.remove("active");
  buttonModeCfg.classList.remove("active");
});
buttonModeGPS.addEventListener("click", function () {
  isManual = false;
  setSidebarContents("gps");
  buttonModeMan.classList.remove("active");
  buttonModeGPS.classList.add("active");
  buttonModeCfg.classList.remove("active");
});
buttonModeCfg.addEventListener("click", function () {
  setSidebarContents("cfg");
  buttonModeMan.classList.remove("active");
  buttonModeGPS.classList.remove("active");
  buttonModeCfg.classList.add("active");
});



clock.innerHTML = moment().format("h:mm:ss a");

while (buttons.length > 0) {
  buttons[0].classList.remove("disabled");
}
applog.info("Board initialized");
navlog.info("App started, waiting for fix");
lastLogged = moment();

// Initialize GPS reader
initGPSReader();

// Initialize GPS status display
updateGPSStatus();

loop();
