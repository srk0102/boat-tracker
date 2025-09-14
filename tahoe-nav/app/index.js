/*
 * index.js
 *
 * Main project logic goes in here
 *
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
console.log(configdata);

// Set up API for Mapbox
const MAPBOX_TOKEN = configdata.mapboxApiKey;
if (MAPBOX_TOKEN.length < 1) {
  console.log("Mapbox API key failed to load: check config.json");
  applog.error("Mapbox API Key not found");
}

// Load Google Maps API
const googleMapsScript = document.createElement("script");
googleMapsScript.type = "text/javascript";
googleMapsScript.async = true;
googleMapsScript.defer = true;
googleMapsScript.src = `https://maps.googleapis.com/maps/api/js?key=${configdata.mapsApiKey}&libraries=geometry&callback=initGoogleMap`;
googleMapsScript.onerror = () => {
  console.error('❌ Google Maps API failed to load');
  const mapElement = document.getElementById("map");
  if (mapElement) {
    mapElement.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; background: #f0f0f0; color: #666; font-family: Arial, sans-serif;"><div style="text-align: center;"><h3>🗺️ Map Loading Error</h3><p>Google Maps API failed to load. Please check your internet connection and API key.</p><p>API Key: ' + configdata.mapsApiKey.substring(0, 10) + '...</p></div></div>';
  }
};
document.getElementsByTagName("head")[0].appendChild(googleMapsScript);

// Import Google Maps implementation
const { initMap, isMapReady, updateVesselPosition, clearVesselBoxes, updateVesselBox } = require('./google-maps-implementation.js');

// Make initMap globally accessible
window.initGoogleMap = initMap;

// Import functions
const { updateDistTable } = require("./sidebarMAN");
const { setSidebarContents } = require("./sidebar");

// Data for gps distance
const haversine = require("haversine");
const convert = require("convert-units");
var disttableheader = ["", "Lat.", "Lon.", 	"\u0394Lat. (ft)", "\u0394Lon. (ft)", "Dist.(ft)"];
var disttabledata = [["Curr. Pos.", "", "", "0", "0", 0]];

var map; // Google Maps Map Object
var markers = []; // Markers for distance points
var zone; // Treatment zone polygon
var zonepath;
var path; // Generated treatment path
var trackedPath; // Path where vessel has already been
var vessel; // Marker for where vessel currently is
var marker; // Close poly marker
var settingZoneState = "init";
var settingPath = false;
var zoneSelected = false;

// Vessel box system
var vesselBoxes = []; // Array of vessel box polygons
var currentVesselBox = null; // Current vessel box
var previousVesselBoxes = []; // Previous vessel boxes

// Function to check if map is ready
function isMapReady() {
  return map && typeof google !== 'undefined' && google.maps;
}

function initMap() {
  console.log('🗺️ Initializing Mapbox GL JS...');
  
  // Ensure the map container exists
  const mapElement = document.getElementById("map");
  if (!mapElement) {
    console.error('❌ Map container not found!');
    return;
  }

  // Check map container dimensions
  const rect = mapElement.getBoundingClientRect();
  console.log('🗺️ Map container dimensions:', rect.width, 'x', rect.height);
  
  if (rect.width === 0 || rect.height === 0) {
    console.warn('⚠️ Map container has zero dimensions, waiting for layout...');
    setTimeout(initMap, 1000);
    return;
  }

  try {
    // Set Mapbox access token
    mapboxgl.accessToken = MAPBOX_TOKEN;
    
    // Initialize Mapbox GL JS map with flat satellite view
    map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/satellite-streets-v12', // Better satellite imagery with streets
      center: [-121.8863, 37.3382], // [lng, lat] - San Jose coordinates
      zoom: 18,
      pitch: 0, // Flat view (no 3D tilt)
      bearing: 0, // Rotation
      antialias: true // Enable antialiasing for better rendering
    });

    // Add navigation controls
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    
    // Add scale control
    map.addControl(new mapboxgl.ScaleControl({
      maxWidth: 100,
      unit: 'metric'
    }), 'bottom-left');
    
    // Set normal cursor for map
    map.getCanvas().style.cursor = 'grab';
    
    // Add cursor change events
    map.on('mouseenter', () => {
      map.getCanvas().style.cursor = 'grab';
    });
    
    map.on('mousedown', () => {
      map.getCanvas().style.cursor = 'grabbing';
    });
    
    map.on('mouseup', () => {
      map.getCanvas().style.cursor = 'grab';
    });

    console.log('✅ Mapbox GL JS initialized successfully');
    
    // Wait for map to load before adding layers
    map.on('load', function() {
      console.log('🗺️ Map loaded, adding custom layers...');
      setupMapLayers();
    });
    
  } catch (error) {
    console.error('❌ Failed to initialize Mapbox GL JS:', error);
    return;
  }

  // Add event listeners
  map.on('dragstart', function () {
    centerOnPos = false;
  });

  // Add window resize listener to ensure map resizes properly
  window.addEventListener('resize', function() {
    if (map) {
      map.resize();
    }
  });

  // Initialize vessel marker with professional navigation pointer
  const vesselElement = document.createElement('div');
  vesselElement.className = 'vessel-marker';
  vesselElement.innerHTML = `
    <div class="nav-pointer">
      <div class="heading-indicator" id="heading-indicator">0°</div>
      <div class="nav-arrow"></div>
      <div class="nav-circle"></div>
    </div>
  `;
  
  // Add CSS styles for the navigation pointer
  const style = document.createElement('style');
  style.textContent = `
    .nav-pointer {
      position: relative;
      width: 40px;
      height: 40px;
      transform-origin: center center;
      transition: transform 0.3s ease;
    }
    
    .nav-arrow {
      position: absolute;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-bottom: 20px solid #FF0000;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));
      z-index: 2;
    }
    
    .nav-circle {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 16px;
      height: 16px;
      background: #FFFFFF;
      border: 3px solid #FF0000;
      border-radius: 50%;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));
      z-index: 1;
    }
    
    .nav-pointer.stopped .nav-arrow {
      border-bottom-color: #666666;
    }
    
    .nav-pointer.stopped .nav-circle {
      border-color: #666666;
      background: #F0F0F0;
    }
    
    /* Heading indicator */
    .heading-indicator {
      position: absolute;
      top: -35px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: bold;
      white-space: nowrap;
      pointer-events: none;
    }
    
    .heading-indicator::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-top: 4px solid rgba(0, 0, 0, 0.8);
    }
  `;
  document.head.appendChild(style);
  
  vessel = new mapboxgl.Marker({
    element: vesselElement,
    rotationAlignment: 'map',
    pitchAlignment: 'map'
  })
  .setLngLat([-119.951611, 38.959533]) // [lng, lat]
  .addTo(map);
}

// Setup Mapbox layers for zones, paths, etc.
function setupMapLayers() {
  // Add zone layer (treatment area)
  map.addSource('zone', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });

  map.addLayer({
    id: 'zone-fill',
    type: 'fill',
    source: 'zone',
    paint: {
      'fill-color': '#FF0000',
      'fill-opacity': 0.2
    }
  });

  map.addLayer({
    id: 'zone-outline',
    type: 'line',
    source: 'zone',
    paint: {
      'line-color': '#FF0000',
      'line-width': 2
    }
  });

  // Add path layer (generated treatment path)
  map.addSource('path', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });

  map.addLayer({
    id: 'path-line',
    type: 'line',
    source: 'path',
    paint: {
      'line-color': '#FFFF00',
      'line-width': 3
    }
  });

  // Add tracked path layer (where vessel has been)
  map.addSource('tracked-path', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });

  map.addLayer({
    id: 'tracked-path-line',
    type: 'line',
    source: 'tracked-path',
    paint: {
      'line-color': '#00FF00',
      'line-width': 2
    }
  });

  // Add vessel box layer (16x40m rectangle around vessel)
  map.addSource('vessel-boxes', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });

  // Current vessel box (green transparent)
  map.addLayer({
    id: 'vessel-box-current',
    type: 'fill',
    source: 'vessel-boxes',
    paint: {
      'fill-color': '#00FF00',
      'fill-opacity': 0.3
    },
    filter: ['==', ['get', 'type'], 'current']
  });

  map.addLayer({
    id: 'vessel-box-current-outline',
    type: 'line',
    source: 'vessel-boxes',
    paint: {
      'line-color': '#00FF00',
      'line-width': 2
    },
    filter: ['==', ['get', 'type'], 'current']
  });

  // Previous vessel boxes (less highlighted)
  map.addLayer({
    id: 'vessel-box-previous',
    type: 'fill',
    source: 'vessel-boxes',
    paint: {
      'fill-color': '#00FF00',
      'fill-opacity': 0.1
    },
    filter: ['==', ['get', 'type'], 'previous']
  });

  map.addLayer({
    id: 'vessel-box-previous-outline',
    type: 'line',
    source: 'vessel-boxes',
    paint: {
      'line-color': '#00FF00',
      'line-width': 1
    },
    filter: ['==', ['get', 'type'], 'previous']
  });

  console.log('✅ Map layers setup complete');

  // Add Mapbox click event handler
  map.on('click', function (e) {
    const clickEvent = { lat: e.lngLat.lat, lng: e.lngLat.lng };
    if (settingPath) {
      addPointToPath(clickEvent.lat, clickEvent.lng);
    } else if (settingZoneState == "setting") {
      addPointToZone(clickEvent.lat, clickEvent.lng);
    }
  });
}

// Helper functions for Mapbox
function addPointToPath(lat, lng) {
  // Add point to path layer
  const currentData = map.getSource('path')._data;
  currentData.features.push({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [lng, lat]
    }
  });
  map.getSource('path').setData(currentData);
}

// Create 16x40m rectangle around vessel position
function createVesselBox(lat, lng, heading, type = 'current') {
  const boxLength = 40; // meters
  const boxWidth = 16;  // meters
  
  // Calculate the four corners of the rectangle
  const halfLength = boxLength / 2;
  const halfWidth = boxWidth / 2;
  
  // Convert heading to radians
  const headingRad = ((heading + 90) * Math.PI) / 180;
  
  // Calculate offsets for each corner
  const corners = [
    { x: -halfLength, y: -halfWidth },  // Bottom-left
    { x: halfLength, y: -halfWidth },   // Bottom-right
    { x: halfLength, y: halfWidth },    // Top-right
    { x: -halfLength, y: halfWidth }    // Top-left
  ];
  
  // Rotate and translate each corner
  const rotatedCorners = corners.map(corner => {
    const rotatedX = corner.x * Math.cos(headingRad) - corner.y * Math.sin(headingRad);
    const rotatedY = corner.x * Math.sin(headingRad) + corner.y * Math.cos(headingRad);
    
    // Convert meters to degrees (approximate)
    const latOffset = rotatedY / 111320; // 1 degree latitude ≈ 111,320 meters
    const lngOffset = rotatedX / (111320 * Math.cos(lat * Math.PI / 180));
    
    return [lng + lngOffset, lat + latOffset];
  });
  
  // Close the polygon
  rotatedCorners.push(rotatedCorners[0]);
  
  return {
    type: 'Feature',
    properties: {
      type: type,
      timestamp: Date.now()
    },
    geometry: {
      type: 'Polygon',
      coordinates: [rotatedCorners]
    }
  };
}

// Update vessel box position
function updateVesselBox(lat, lng, heading) {
  if (!map || !map.getSource('vessel-boxes')) return;
  
  const currentData = map.getSource('vessel-boxes')._data;
  
  // Convert previous current box to previous box
  const currentBoxes = currentData.features.filter(f => f.properties.type === 'current');
  currentBoxes.forEach(box => {
    box.properties.type = 'previous';
  });
  
  // Keep only last 10 previous boxes to avoid clutter
  const previousBoxes = currentData.features.filter(f => f.properties.type === 'previous');
  if (previousBoxes.length > 10) {
    previousBoxes.sort((a, b) => b.properties.timestamp - a.properties.timestamp);
    const toRemove = previousBoxes.slice(10);
    toRemove.forEach(box => {
      const index = currentData.features.indexOf(box);
      if (index > -1) currentData.features.splice(index, 1);
    });
  }
  
  // Add new current box
  const newBox = createVesselBox(lat, lng, heading, 'current');
  currentData.features.push(newBox);
  
  // Update the map
  map.getSource('vessel-boxes').setData(currentData);
  
  console.log('📦 Vessel box updated:', {
    position: [lat.toFixed(6), lng.toFixed(6)],
    heading: heading.toFixed(1) + '°',
    totalBoxes: currentData.features.length
  });
}

// Clear all vessel boxes
function clearVesselBoxes() {
  if (!map || !map.getSource('vessel-boxes')) return;
  
  const currentData = map.getSource('vessel-boxes')._data;
  currentData.features = [];
  map.getSource('vessel-boxes').setData(currentData);
  
  console.log('📦 Vessel boxes cleared');
}

function addPointToZone(lat, lng) {
  // Add point to zone layer
  const currentData = map.getSource('zone')._data;
  if (currentData.features.length === 0) {
    // Start new polygon
    currentData.features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[lng, lat]]]
      }
    });
  } else {
    // Add to existing polygon
    currentData.features[0].geometry.coordinates[0].push([lng, lat]);
  }
  map.getSource('zone').setData(currentData);
}

function updateTrackedPath(positions) {
  // Update the tracked path layer with vessel positions
  if (!positions || positions.length === 0) return;
  
  const coordinates = positions.map(pos => [pos.lng, pos.lat]);
  
  const trackedPathData = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coordinates
      }
    }]
  };
  
  if (map && map.getSource('tracked-path')) {
    map.getSource('tracked-path').setData(trackedPathData);
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
  
  // Update vessel marker appearance - always keep red (no stopped state)
  if (vessel && vessel.getElement) {
    const navPointer = vessel.getElement().querySelector('.nav-pointer');
    const headingIndicator = vessel.getElement().querySelector('.heading-indicator');
    
    // Always remove stopped class to keep pointer red
    if (navPointer) {
      navPointer.classList.remove('stopped');
    }
    
    // Update heading indicator
    if (headingIndicator) {
      headingIndicator.textContent = `${Math.round(vesselHeading)}°`;
    }
  }
  
  // Update position history for smoothing
  positionHistory.push({ pos: newPos, time: now });
  if (positionHistory.length > 10) {
    positionHistory.shift(); // Keep only last 10 positions
  }
  
  lastValidPos = newPos;
  lastUpdateTime = now;
}

// Debug function to force heading update (for testing)
function debugHeadingUpdate(newHeading) {
  if (newHeading >= 0 && newHeading <= 360) {
    vesselHeading = newHeading;
    console.log('🔧 DEBUG: Forced heading update to:', newHeading.toFixed(1) + '°');
    
    if (vessel) {
      vessel.setRotation(vesselHeading);
      updateVesselState(pos || { lat: 0, lng: 0 }, 0);
    }
  }
}

// Make debug function available globally for console testing
window.debugHeadingUpdate = debugHeadingUpdate;

// Debug function to adjust filter settings
function debugFilterSettings(settings) {
  if (gpsReader && gpsReader.roverFilter) {
    // Update rover filter settings
    Object.assign(gpsReader.roverFilter.cfg, settings);
    console.log('🔧 DEBUG: Updated rover filter settings:', gpsReader.roverFilter.cfg);
  }
  if (gpsReader && gpsReader.baseFilter) {
    // Update base filter settings
    Object.assign(gpsReader.baseFilter.cfg, settings);
    console.log('🔧 DEBUG: Updated base filter settings:', gpsReader.baseFilter.cfg);
  }
}

// Debug function to get filter statistics
function debugFilterStats() {
  if (gpsReader && gpsReader.roverFilter) {
    console.log('🔧 Rover Filter Stats:', gpsReader.roverFilter.getStats());
  }
  if (gpsReader && gpsReader.baseFilter) {
    console.log('🔧 Base Filter Stats:', gpsReader.baseFilter.getStats());
  }
}

// Make debug functions available globally
window.debugFilterSettings = debugFilterSettings;
window.debugFilterStats = debugFilterStats;

// Geometry helper functions to replace Google Maps geometry
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

function computeOffset(from, distance, heading) {
  // Calculate a point at a given distance and bearing from another point
  const R = 6371000; // Earth's radius in meters
  const lat1 = from.lat * Math.PI / 180;
  const lng1 = from.lng * Math.PI / 180;
  const bearing = heading * Math.PI / 180;
  
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distance / R) +
    Math.cos(lat1) * Math.sin(distance / R) * Math.cos(bearing));
  
  const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(distance / R) * Math.cos(lat1),
    Math.cos(distance / R) - Math.sin(lat1) * Math.sin(lat2));
  
  return {
    lat: lat2 * 180 / Math.PI,
    lng: lng2 * 180 / Math.PI
  };
}

function generatePath() {
  // Check if zone is properly initialized (Mapbox format)
  if (!zone || !zone.coordinates || zone.coordinates.length < 3) {
    console.warn('Zone not properly defined. Please select a zone first.');
    alert('Please select a treatment zone before generating a path.');
    return;
  }

  try {
    // Convert Mapbox polygon coordinates to simple lat/lng array
    const vertices = zone.coordinates[0]; // Get the outer ring of the polygon
    vArray = [];
    
    for (var i = 0; i < vertices.length; i++) {
      const xy = { lat: vertices[i][1], lng: vertices[i][0] }; // Mapbox uses [lng, lat]
      vArray.push(xy);
    }
    
    console.log('Zone vertices:', vArray);
    
    // For now, create a simple path along the zone boundary
    // TODO: Implement proper path generation algorithm for Mapbox
    if (vArray.length >= 2) {
      // Simple implementation: create a path that follows the zone boundary
      const pathCoordinates = vArray.map(vertex => [vertex.lng, vertex.lat]);
      
      // Update the path source
      if (map && map.getSource('path')) {
        const pathData = {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: pathCoordinates
            }
          }]
        };
        map.getSource('path').setData(pathData);
      }
      
      console.log('Path generated with', pathCoordinates.length, 'points');
    }
    
    document.getElementById("set-zone-button").innerHTML = "Select Zone";
    settingZoneState = "init";
    
  } catch (error) {
    console.error('Error generating path:', error);
    alert('Error generating path. Please try again.');
  }
}

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
var trackedPos = [];
var hasFix = false;
var lastLogged;
var startLog;
var centerOnPos = true;

// GPS filtering and movement detection
var lastValidPos = null;
var lastUpdateTime = 0;
var positionHistory = [];
var isMoving = false;
var movementThreshold = 1.0; // meters - reduced for better responsiveness
var timeThreshold = 500; // milliseconds - reduced for faster updates
var minAccuracy = 15.0; // meters - more lenient for testing

// Dual GPS Setup - COM8 as base, COM12 as rover
var gpsReader = null;
var vesselHeading = 0;
var roverConnected = false;
var baseConnected = false;

// Initialize GPS reader
function initGPSReader() {
  try {
    if (configdata.useRoverBase) {
      const DualGPSReader = require('./dual-gps-reader.js');
      gpsReader = new DualGPSReader(configdata.gpsPort, configdata.baseStationPort, 19200, 115200);
      console.log('Using Dual GPS Reader (Rover-Base RTK)...');
      console.log(`Rover (${configdata.gpsPort}): 19200 baud, Base (${configdata.baseStationPort}): 115200 baud`);
    } else {
      const SimpleGPSReader = require('./simple-gps-reader.js');
      gpsReader = new SimpleGPSReader(configdata.gpsPort, 9600); // Try 9600 baud first
      console.log('Using Simple GPS Reader...');
    }

    gpsReader.on('data', (data) => {
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
            console.log('📍 Using GPS course:', course.toFixed(1) + '°');
          } else if (lastValidPos && isMoving) {
            // Calculate heading from position changes when moving
            vesselHeading = computeHeading(lastValidPos, pos);
            console.log('📍 Calculated from movement:', vesselHeading.toFixed(1) + '°');
          }
          
          hasFix = true;
          updateVesselState(pos, speed, accuracy);
          
          console.log('📍 GPS Position:', `Lat: ${pos.lat.toFixed(6)}, Lng: ${pos.lng.toFixed(6)}, Course: ${vesselHeading.toFixed(1)}°, Speed: ${speed.toFixed(1)} kts, GPS Course: ${course.toFixed(1)}°, Moving: ${isMoving}`);
          
          // Update vessel position and rotation on map if map is ready
          if (isMapReady()) {
            updateVesselPosition(pos.lat, pos.lng, vesselHeading);
          }
        }
      }
    });

    gpsReader.on('rtkData', (data) => {
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
          console.log('🎯 Using RTK heading:', data.heading.toFixed(1) + '°');
        } else if (course > 0 && course <= 360) {
          vesselHeading = course;
          console.log('🎯 Using GPS course:', course.toFixed(1) + '°');
        } else if (lastValidPos && isMoving) {
          vesselHeading = computeHeading(lastValidPos, pos);
          console.log('🎯 Calculated from movement:', vesselHeading.toFixed(1) + '°');
        }
        
        hasFix = true;
        updateVesselState(pos, speed, accuracy);
        
        console.log('🎯 RTK Position:', `Lat: ${pos.lat.toFixed(6)}, Lng: ${pos.lng.toFixed(6)}, Heading: ${vesselHeading.toFixed(1)}°, Speed: ${speed.toFixed(1)} kts, Course: ${course.toFixed(1)}°, Moving: ${isMoving}`);
        
        // Update vessel position and rotation on map if map is ready
        if (isMapReady()) {
          updateVesselPosition(pos.lat, pos.lng, vesselHeading);
        }
      }
    });

    gpsReader.on('roverConnected', (connected) => {
      roverConnected = connected;
      updateGPSStatus();
    });

    gpsReader.on('baseConnected', (connected) => {
      baseConnected = connected;
      updateGPSStatus();
    });

    gpsReader.on('error', (error) => {
      console.error('GPS Error:', error);
    });

    gpsReader.on('disconnect', () => {
      console.log('GPS disconnected');
      hasFix = false;
      roverConnected = false;
      baseConnected = false;
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

//gps.on("sentence", sentence => console.log(sentence) );

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
        updateVesselPosition(pos.lat, pos.lng, vesselHeading);
      }
      
      // Update vessel state for movement detection
      updateVesselState(pos, 0); // Speed will be calculated from position changes
    } else {
      if (!hasFix) console.log('🚢 ⏳ No GPS fix yet...');
      if (!pos) console.log('🚢 ⏳ No position data yet...');
      if (!isMapReady()) console.log('🚢 ⏳ Map not ready yet...');
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
      updateTrackedPath(trackedPos);
      lastLogged = moment();
    } else if (!hasFix && pos && pos.lat) {
      // Fix just established
      hasFix = true;
      navlog.info("GNSS Fix established");
    }

    // Map center conditions
    if (centerOnPos && hasFix) {
      map.setCenter(pos);
    }

    loop();
  }, 100);
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
