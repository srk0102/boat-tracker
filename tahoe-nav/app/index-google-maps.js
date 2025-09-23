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
  console.error("❌ Google Maps API failed to load");
  const mapElement = document.getElementById("map");
  if (mapElement) {
    mapElement.innerHTML =
      '<div style="display: flex; align-items: center; justify-content: center; height: 100%; background: #f0f0f0; color: #666; font-family: Arial, sans-serif;"><div style="text-align: center;"><h3>🗺️ Map Loading Error</h3><p>Google Maps API failed to load. Please check your internet connection and API key.</p><p>API Key: ' +
      configdata.mapsApiKey.substring(0, 10) +
      "...</p></div></div>";
  }
};
document.getElementsByTagName("head")[0].appendChild(googleMapsScript);

// Import Google Maps implementation
const {
  initMap,
  isMapReady,
  updateVesselPosition,
  clearVesselBoxes,
  updateVesselBox,
  loadBoatDimensions,
  getSailingStatus,
  clearBoatPath,
  resumePathCreation,
  setVesselCreationDistance,
  getVesselCreationDistance,
  setHeadingZero,
  clearHeadingZero,
  setLogger, // << NEW
} = require("./google-maps-implementation.js");

// Pipe navlog into the map implementation for calibration logs
setLogger((msg) => navlog.info(msg));

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
var disttableheader = [
  "",
  "Lat.",
  "Lon.",
  "\u0394Lat. (ft)",
  "\u0394Lon. (ft)",
  "Dist.(ft)",
];
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

// GPS filtering and movement detection
var lastValidPos = null;
var lastUpdateTime = 0;
var positionHistory = [];
var isMoving = false;
var movementThreshold = 0.0; // meters
var timeThreshold = 500; // ms
var minAccuracy = 15.0; // meters

// Dual GPS Setup - COM7 as rover, COM12 as base
var gpsReader = null;
var vesselHeading = 0;
var roverConnected = false;
var baseConnected = false;
var lastRoverStatus = null; // Track last rover connection status
var lastBaseStatus = null; // Track last base connection status

// Make isTracking globally accessible for sidebar
var isTracking = false;
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

// Handy globals to zero/clear heading
window.zeroHeading = () => setHeadingZero();
window.clearZeroHeading = () => clearHeadingZero();

// Press Z to zero heading; Shift+Z to clear
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "z" && !e.shiftKey) setHeadingZero();
  if (e.key.toLowerCase() === "z" && e.shiftKey) clearHeadingZero();
});

var trackedPos = [];
var hasFix = false;
var lastLogged;
var startLog;
var centerOnPos = true;

// --- map update scheduler (one draw per frame; RTK wins) -----------
const raf = window.requestAnimationFrame
  ? window.requestAnimationFrame.bind(window)
  : (fn) => setTimeout(fn, 16);

let pendingUpdate = null;
let updateScheduled = false;
let lastApplied = null;

const almostEqual = (a, b, eps = 1e-7) => Math.abs(a - b) < eps;
const sameSample = (a, b) =>
  a &&
  b &&
  almostEqual(a.lat, b.lat) &&
  almostEqual(a.lng, b.lng) &&
  Math.abs(((a.heading - b.heading + 540) % 360) - 180) < 0.1;

const scheduleMapUpdate = (sample) => {
  if (!pendingUpdate || sample.source === "rtk") pendingUpdate = sample;

  if (!updateScheduled) {
    updateScheduled = true;
    raf(() => {
      updateScheduled = false;
      if (!pendingUpdate) return;
      const s = pendingUpdate;
      pendingUpdate = null;

      if (lastApplied && sameSample(lastApplied, s)) return;
      lastApplied = s;

      if (isMapReady()) {
        const speedMs = (s.speedKts || 0) * 0.514444; // knots -> m/s
        updateVesselPosition(s.lat, s.lng, s.heading, centerOnPos, {
          speedMs,
          hasRTKHeading: !!s.hasRTKHeading,
        });
      }
    });
  }
};

// Initialize GPS reader
function initGPSReader() {
  try {
    if (configdata.useRoverBase) {
      const DualGPSReader = require("./dual-gps-reader.js");
      gpsReader = new DualGPSReader(
        configdata.gpsPort,
        configdata.baseStationPort,
        19200,
        115200
      );
    } else {
      const SimpleGPSReader = require("./simple-gps-reader.js");
      gpsReader = new SimpleGPSReader(configdata.gpsPort, 9600);
    }

    gpsReader.on("data", (data) => {
      console.log("📍 GPS Data received:", {
        lat: data.lat ? data.lat.toFixed(6) : "No data",
        lng: data.lng ? data.lng.toFixed(6) : "No data",
        speed: data.speed || 0,
        course: data.course || 0,
        accuracy: data.accuracy || "Unknown",
      });

      if (data.lat && data.lng) {
        const newPos = { lat: data.lat, lng: data.lng };
        const accuracy = data.accuracy || 5.0; // Assume 5m accuracy if not provided
        const speed = data.speed || 0; // knots
        const course = data.course || 0; // degrees

        if (shouldUpdatePosition(newPos, accuracy)) {
          pos = newPos;

          // Heading preference: course -> movement bearing
          if (course > 0 && course <= 360) {
            vesselHeading = course;
          } else if (lastValidPos && isMoving) {
            vesselHeading = computeHeading(lastValidPos, pos);
          }

          hasFix = true;
          updateVesselState(pos, speed, accuracy);

          // Schedule map update (NMEA)
          scheduleMapUpdate({
            source: "nmea",
            lat: pos.lat,
            lng: pos.lng,
            heading: vesselHeading,
            speedKts: speed,
            hasRTKHeading: false,
          });
        }
      }
    });

    gpsReader.on("rtkData", (data) => {
      if (data.rover) {
        console.log("🔵 Rover GPS Data:", {
          lat: data.rover.lat ? data.rover.lat.toFixed(6) : "No data",
          lng: data.rover.lng ? data.rover.lng.toFixed(6) : "No data",
          speed: data.rover.speed || 0,
          course: data.rover.course || 0,
        });
      }

      if (data.base) {
        console.log("🟡 Base GPS Data:", {
          lat: data.base.lat ? data.base.lat.toFixed(6) : "No data",
          lng: data.base.lng ? data.base.lng.toFixed(6) : "No data",
          speed: data.base.speed || 0,
          course: data.base.course || 0,
        });
      }

      if (
        data.rover &&
        Number.isFinite(data.rover.lat) &&
        Number.isFinite(data.rover.lng)
      ) {
        const newPos = { lat: data.rover.lat, lng: data.rover.lng };
        const accuracy = 1.0; // RTK
        const speed = data.rover.speed || 0; // knots
        const course = data.rover.course || 0;

        pos = newPos;

        // ✅ Prefer true RTK yaw only when reader says it's RTK
        const headingFromRTK = !!data.hasRTKHeading;
        if (headingFromRTK && Number.isFinite(data.heading)) {
          vesselHeading = data.heading; // true yaw (base→rover)
        } else if (course > 0 && course <= 360) {
          vesselHeading = course; // fall back to COG
        } else if (lastValidPos && isMoving) {
          vesselHeading = computeHeading(lastValidPos, pos); // last resort: motion bearing
        }

        hasFix = true;
        updateVesselState(pos, speed, accuracy);

        // Pass through the RTK flag so the map logic knows when to disable reverse heuristics
        scheduleMapUpdate({
          source: "rtk",
          lat: pos.lat,
          lng: pos.lng,
          heading: vesselHeading,
          speedKts: speed,
          hasRTKHeading: headingFromRTK,
        });
      }
    });

    gpsReader.on("roverConnected", (connected) => {
      roverConnected = connected;
      if (lastRoverStatus !== connected) {
        console.log(
          "🔵 Rover GPS Connection:",
          connected ? "CONNECTED" : "DISCONNECTED"
        );
        lastRoverStatus = connected;
      }
      updateGPSStatus();
    });

    gpsReader.on("baseConnected", (connected) => {
      baseConnected = connected;
      if (lastBaseStatus !== connected) {
        console.log(
          "🟡 Base GPS Connection:",
          connected ? "CONNECTED" : "DISCONNECTED"
        );
        lastBaseStatus = connected;
      }
      updateGPSStatus();
    });

    gpsReader.on("error", (error) => {
      console.error("GPS error:", error);
    });

    gpsReader.on("disconnect", () => {
      console.log("GPS disconnected");
      hasFix = false;
      roverConnected = false;
      baseConnected = false;
      lastRoverStatus = false;
      lastBaseStatus = false;
      updateGPSStatus();
    });

    gpsReader.connect();
  } catch (error) {
    console.error("Failed to initialize GPS reader:", error);
  }
}

// Update GPS status display
function updateGPSStatus() {
  const gpsInfo = document.getElementById("gps-info");
  if (gpsInfo) {
    let statusText = "GPS: ";

    if (roverConnected && baseConnected) {
      statusText += "Rover ✓ Base ✓ | RTK: Ready";
    } else if (roverConnected) {
      statusText += "Rover ✓ Base ✗ | Single GPS";
    } else if (baseConnected) {
      statusText += "Rover ✗ Base ✓ | Single GPS";
    } else {
      statusText += "Connecting...";
    }

    gpsInfo.textContent = statusText;
  }
}

// GPS filtering and movement detection functions
function calculateDistance(pos1, pos2) {
  const R = 6371000;
  const dLat = ((pos2.lat - pos1.lat) * Math.PI) / 180;
  const dLng = ((pos2.lng - pos1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((pos1.lat * Math.PI) / 180) *
      Math.cos((pos2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function isGPSDataValid(newPos, accuracy = 10.0) {
  if (!newPos || !newPos.lat || !newPos.lng) return false;
  if (isNaN(newPos.lat) || isNaN(newPos.lng)) return false;
  if (newPos.lat === 0 && newPos.lng === 0) return false;
  if (newPos.lat < -90 || newPos.lat > 90) return false;
  if (newPos.lng < -180 || newPos.lng > 180) return false;
  if (accuracy > minAccuracy) return false;
  return true;
}

function shouldUpdatePosition(newPos, accuracy = 10.0) {
  const now = Date.now();
  if (!lastValidPos) return true;
  if (now - lastUpdateTime < timeThreshold) return false;
  if (!isGPSDataValid(newPos, accuracy)) return false;

  const distance = calculateDistance(lastValidPos, newPos);
  return distance >= movementThreshold;
}

function updateVesselState(newPos, speed = 0, accuracy = 10.0) {
  const now = Date.now();
  if (speed > 0.5) {
    // speed in knots
    isMoving = true;
  } else if (lastValidPos) {
    const distance = calculateDistance(lastValidPos, newPos);
    const timeSinceLastUpdate = now - lastUpdateTime;
    const calculatedSpeed = distance / (timeSinceLastUpdate / 1000); // m/s
    isMoving = calculatedSpeed > 0.2; // ~0.4 knots
  }

  positionHistory.push({ pos: newPos, time: now });
  if (positionHistory.length > 10) positionHistory.shift();

  lastValidPos = newPos;
  lastUpdateTime = now;
}

// Geometry helper functions
function computeHeading(from, to) {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  let heading = (Math.atan2(y, x) * 180) / Math.PI;
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

boardstatus.innerHTML = "No Arduino Connected (not required)";

function loop() {
  setTimeout(() => {
    // Current time
    clock.innerHTML = moment().format("h:mm:ss a");

    // Update tracking timer
    if (isTracking) {
      let duration = moment() - startLog;
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

    // No map updates here (scheduler handles them).
    if (hasFix && pos) {
      updateVesselState(pos, 0); // derive speed from deltas
    }

    // Update gps distance table, if it exists
    if (hasFix && document.getElementById("coord-table-container")) {
      updateDistTable();
    }

    // Logging conditions
    if (hasFix && isTracking && moment() - lastLogged > 500) {
      navlog.info(pos);
      trackedPos.push(pos);
      lastLogged = moment();
    } else if (!hasFix && pos && pos.lat) {
      hasFix = true;
      navlog.info("GNSS Fix established");
    }

    loop();
  }, 50); // ~20 Hz
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
