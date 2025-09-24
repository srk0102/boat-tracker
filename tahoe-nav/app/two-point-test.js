// Two Point GPS Test - Real dual u-blox GPS vessel box visualization
console.log('🚀 Two Point GPS Test starting...');

const DualUbloxReader = require('./dual-ublox-reader.js');

// Global variables
var map;
var pointsSource;
var vesselBoxSource;
var pathSource;
var addedPointsSource;
var gpsReader = null;
var configdata = {};
var roverGPS = { lat: null, lng: null, fix: false };
var baseGPS = { lat: null, lng: null, fix: false };
var vesselLength = 40; // feet
var vesselWidth = 16; // feet
var isTracking = false;
var pathPoints = [];
var addedPoints = [];
var hasAutoCentered = false; // Track if we've auto-centered on startup
var reconnectInterval = null; // For GPS reconnection attempts
var isReconnecting = false;

// Heading smoothing variables
var currentHeading = 0; // Current smoothed heading
var headingHistory = []; // Store recent headings for smoothing
var lastValidHeading = 0; // Last reliable heading when moving fast enough
var previousPosition = null; // For speed calculation
var currentSpeed = 0; // Current speed in mph
var MIN_SPEED_FOR_HEADING = 0.3; // Minimum speed (mph) to trust GPS heading
var HEADING_SMOOTHING_FACTOR = 0.15; // Lower = more smoothing (0.1-0.3)
var MAX_HEADING_HISTORY = 10; // Number of headings to keep for smoothing

// Calculate bearing between two GPS points
function calculateBearing(lat1, lng1, lat2, lng2) {
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

// Calculate distance between two points in meters
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate speed from position change
function calculateSpeed(currentPos, previousPos, timeDelta) {
  if (!previousPos || timeDelta <= 0) return 0;
  
  const distance = calculateDistance(
    previousPos.lat, previousPos.lng,
    currentPos.lat, currentPos.lng
  );
  
  // Convert to mph (meters per second to mph)
  const speedMps = distance / (timeDelta / 1000); // m/s
  const speedMph = speedMps * 2.237; // Convert to mph
  
  return speedMph;
}

// Normalize angle to 0-360 range
function normalizeAngle(angle) {
  while (angle < 0) angle += 360;
  while (angle >= 360) angle -= 360;
  return angle;
}

// Calculate the shortest angular difference between two headings
function angleDifference(a1, a2) {
  let diff = a2 - a1;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return diff;
}

// Smooth heading using exponential moving average and speed filtering
function smoothHeading(newHeading, speed) {
  // Normalize the new heading
  newHeading = normalizeAngle(newHeading);

  if (speed < MIN_SPEED_FOR_HEADING) {
    // Too slow, hold last valid heading
    currentHeading = lastValidHeading;
    console.log(`🐌 Speed too low (${speed.toFixed(2)}mph), holding last valid heading: ${currentHeading.toFixed(1)}°`);
  } else if (speed < 3.0) {
    // Low speed, use raw heading for accuracy
    currentHeading = newHeading;
    lastValidHeading = currentHeading;
    console.log(`🚶‍♂️ Low speed (${speed.toFixed(2)}mph), using raw heading: ${currentHeading.toFixed(1)}°`);
  } else {
    // High speed, apply smoothing to reduce jitter
    const smoothingFactor = 0.15; // or use HEADING_SMOOTHING_FACTOR
    const diff = angleDifference(currentHeading, newHeading);
    currentHeading = normalizeAngle(currentHeading + (diff * smoothingFactor));
    lastValidHeading = currentHeading;
    console.log(`🏎️ High speed (${speed.toFixed(2)}mph), smoothed heading: ${currentHeading.toFixed(1)}°`);
  }
  return currentHeading;
}

// Load configuration
try {
  configdata = require("../config.json");
  console.log("✅ Configuration loaded:", configdata);
  
  // Update vessel dimensions from config if available
  if (configdata.boatDimensions) {
    vesselLength = configdata.boatDimensions.length || 40;
    vesselWidth = configdata.boatDimensions.width || 16;
    console.log(`📏 Vessel dimensions from config: ${vesselLength}ft x ${vesselWidth}ft`);
  }
} catch (error) {
  console.error("❌ Failed to load config.json:", error);
  console.error("❌ Please ensure config.json exists with GPS port configuration");
  configdata = {
    primaryGpsPort: null,
    secondaryGpsPort: null, 
    gpsBaudRate: 9600,
    boatDimensions: {
      length: 40,
      width: 16,
      unit: "feet"
    }
  };
}

// Initialize map
function initMap() {
  console.log('🗺️ Initializing real GPS test map...');
  
  try {
    // Create vector sources
    pointsSource = new ol.source.Vector();
    vesselBoxSource = new ol.source.Vector();
    pathSource = new ol.source.Vector();
    addedPointsSource = new ol.source.Vector();
    
    // Create satellite layer with better zoom levels
    const satelliteLayer = new ol.layer.Tile({
      source: new ol.source.XYZ({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attributions: '© Esri, Maxar, Earthstar Geographics',
        maxZoom: 20
      })
    });
    
    // Create points layer with smaller F and B labels (secondary to green box)
    const pointsLayer = new ol.layer.Vector({
      source: pointsSource,
      style: function(feature) {
        const type = feature.get('type');
        if (type === 'rover') {
          return new ol.style.Style({
            image: new ol.style.Circle({
              radius: 6,  // Smaller points
              fill: new ol.style.Fill({ color: '#FF0000' }),
              stroke: new ol.style.Stroke({ color: '#FFFFFF', width: 1 })
            }),
            text: new ol.style.Text({
              text: 'F',
              fill: new ol.style.Fill({ color: '#FFFFFF' }),
              font: 'bold 10px Arial'  // Smaller text
            })
          });
        } else if (type === 'base') {
          return new ol.style.Style({
            image: new ol.style.Circle({
              radius: 6,  // Smaller points
              fill: new ol.style.Fill({ color: '#0000FF' }),
              stroke: new ol.style.Stroke({ color: '#FFFFFF', width: 1 })
            }),
            text: new ol.style.Text({
              text: 'B',
              fill: new ol.style.Fill({ color: '#FFFFFF' }),
              font: 'bold 10px Arial'  // Smaller text
            })
          });
        }
      },
      zIndex: 50  // Below the green box
    });
    
    // Create vessel box layer - MAIN FOCUS - SUPER VISIBLE
    const vesselBoxLayer = new ol.layer.Vector({
      source: vesselBoxSource,
      style: new ol.style.Style({
        fill: new ol.style.Fill({
          color: 'rgba(0, 255, 0, 0.8)'  // Even more opaque green fill
        }),
        stroke: new ol.style.Stroke({
          color: '#00FF00',
          width: 8  // Even thicker border
        })
      }),
      zIndex: 1000  // Way on top
    });
    
    // Create path layer
    const pathLayer = new ol.layer.Vector({
      source: pathSource,
      style: new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: '#FF0000',
          width: 3
        })
      })
    });
    
    // Create added points layer - transparent green boxes
    const addedPointsLayer = new ol.layer.Vector({
      source: addedPointsSource,
      style: new ol.style.Style({
        fill: new ol.style.Fill({
          color: 'rgba(0, 255, 0, 0.3)'  // Transparent green fill
        }),
        stroke: new ol.style.Stroke({
          color: '#00FF00',
          width: 2
        })
      }),
      zIndex: 75  // Above path but below main vessel box
    });
    
    // Create map with reasonable zoom
    map = new ol.Map({
      target: 'map',
      layers: [
        satelliteLayer,
        pathLayer,
        addedPointsLayer,
        vesselBoxLayer,
        pointsLayer
      ],
      view: new ol.View({
        center: ol.proj.fromLonLat([-121.8863, 37.3382]),
        zoom: 18,
        maxZoom: 20
      })
    });
    
    console.log('✅ Real GPS test map initialized successfully!');
    
  } catch (error) {
    console.error('❌ Failed to initialize test map:', error);
  }
}

// Update dual GPS data from real GPS receivers
function updateDualGPS(primary, secondary) {
  roverGPS = primary;  // Rover is primary (front)
  baseGPS = secondary; // Base is secondary (back)
  
  console.log('📍 GPS Update:', {
    rover: { lat: roverGPS.lat?.toFixed(6), lng: roverGPS.lng?.toFixed(6), fix: roverGPS.fix },
    base: { lat: baseGPS.lat?.toFixed(6), lng: baseGPS.lng?.toFixed(6), fix: baseGPS.fix }
  });
  
  if (roverGPS.fix && baseGPS.fix) {
    // Calculate current vessel center position
    const centerLat = (roverGPS.lat + baseGPS.lat) / 2;
    const centerLng = (roverGPS.lng + baseGPS.lng) / 2;
    const currentPosition = { lat: centerLat, lng: centerLng, timestamp: Date.now() };
    
    // Calculate speed if we have a previous position
    if (previousPosition && previousPosition.timestamp) {
      const timeDelta = currentPosition.timestamp - previousPosition.timestamp;
      currentSpeed = calculateSpeed(currentPosition, previousPosition, timeDelta);
    }
    
    // Calculate raw heading from rover to base
    const rawHeading = calculateBearing(roverGPS.lat, roverGPS.lng, baseGPS.lat, baseGPS.lng);
    
    // Apply heading smoothing based on speed
    const smoothedHeading = smoothHeading(rawHeading, currentSpeed);
    
    // Store current position for next speed calculation
    previousPosition = currentPosition;
    
    // Use properly calibrated vessel box with smoothed heading
    createCalibratedVesselBoxWithHeading(smoothedHeading);
    
    // Auto-center on vessel on first GPS fix
    if (!hasAutoCentered) {
      console.log('🎯 Auto-centering on vessel for first time...');
      centerMapOnVessel();
      hasAutoCentered = true;
    }
    
    // Add to path if tracking
    if (isTracking) {
      pathPoints.push({ 
        lat: centerLat, 
        lng: centerLng, 
        timestamp: new Date().toISOString(),
        heading: smoothedHeading,
        speed: currentSpeed
      });
      updatePathLine();
    }
  }
  
  // Update UI
  updateUI();
}

// Create vessel box between rover and base GPS points
function createVesselBox() {
  if (!roverGPS.fix || !baseGPS.fix) {
    console.log('❌ Cannot create vessel box - no GPS fix');
    return;
  }
  
  console.log('🟢🟢🟢 CREATING THE MAIN GREEN BOX 🟢🟢🟢');
  console.log('🛥️ Creating vessel box from real GPS...');
  
  const length = parseFloat(document.getElementById('vessel-length').value) || 40;
  const width = parseFloat(document.getElementById('vessel-width').value) || 16;
  
  console.log('🟢 GREEN BOX is the MAIN FOCUS - not just points!');
  
  vesselLength = length;
  vesselWidth = width;
  
  // Clear existing features
  pointsSource.clear();
  vesselBoxSource.clear();
  
  // Add GPS points to map
  const roverFeature = new ol.Feature({
    geometry: new ol.geom.Point(ol.proj.fromLonLat([roverGPS.lng, roverGPS.lat])),
    type: 'rover'
  });
  pointsSource.addFeature(roverFeature);
  
  const baseFeature = new ol.Feature({
    geometry: new ol.geom.Point(ol.proj.fromLonLat([baseGPS.lng, baseGPS.lat])),
    type: 'base'
  });
  pointsSource.addFeature(baseFeature);
  
  // Calculate heading from rover to base
  const heading = calculateBearing(roverGPS.lat, roverGPS.lng, baseGPS.lat, baseGPS.lng);
  
  console.log('🧭 Calculated heading:', heading.toFixed(1) + '°');
  
  // Calculate distance between GPS points
  const distance = calculateDistance(roverGPS.lat, roverGPS.lng, baseGPS.lat, baseGPS.lng);
  
  console.log('📏 Distance between GPS units:', distance.toFixed(2) + 'm');
  
  // Convert feet to meters
  const lengthMeters = length * 0.3048;
  const widthMeters = width * 0.3048;
  
  console.log('📐 Creating box around F and B points like |F----B|');
  
  // Create vessel rectangle that encompasses both F and B points
  // Make the box longer than the distance to ensure both points are inside
  const boxLength = Math.max(lengthMeters, distance + 5); // At least 5m longer than distance
  const boxWidth = widthMeters;
  
  // Center the box between the two GPS points
  const centerLat = (roverGPS.lat + baseGPS.lat) / 2;
  const centerLng = (roverGPS.lng + baseGPS.lng) / 2;
  
  console.log('📐 Box center:', { lat: centerLat.toFixed(6), lng: centerLng.toFixed(6) });
  console.log('📐 Box dimensions:', { length: boxLength.toFixed(2) + 'm', width: boxWidth.toFixed(2) + 'm' });
  
  const halfLength = boxLength / 2;
  const halfWidth = boxWidth / 2;
  const headingRad = (heading * Math.PI) / 180;
  
  // Calculate vessel box corners
  const corners = [
    { x: -halfLength, y: -halfWidth },
    { x: halfLength, y: -halfWidth },
    { x: halfLength, y: halfWidth },
    { x: -halfLength, y: halfWidth },
  ];
  
  const rotatedCorners = corners.map((corner, index) => {
    const rx = corner.x * Math.cos(headingRad) - corner.y * Math.sin(headingRad);
    const ry = corner.x * Math.sin(headingRad) + corner.y * Math.cos(headingRad);
    const latOffset = ry / 111320;
    const lngOffset = rx / (111320 * Math.cos((centerLat * Math.PI) / 180));
    const finalLng = centerLng + lngOffset;
    const finalLat = centerLat + latOffset;
    
    console.log(`📍 Corner ${index}:`, { lng: finalLng.toFixed(6), lat: finalLat.toFixed(6) });
    
    return [finalLng, finalLat];
  });
  
  // Close the polygon
  rotatedCorners.push(rotatedCorners[0]);
  
  // Create vessel box feature - THE MAIN THING
  console.log('🟢 CREATING GREEN BOX - Main focus!');
  console.log('🟢 Box corners (lat/lng):', rotatedCorners);
  
  // Convert to map projection
  const projectedCorners = rotatedCorners.map(corner => ol.proj.fromLonLat(corner));
  console.log('🟢 Box corners (projected):', projectedCorners);
  
  const vesselBoxFeature = new ol.Feature({
    geometry: new ol.geom.Polygon([projectedCorners])
  });
  
  console.log('🟢 Adding green box to map...');
  vesselBoxSource.addFeature(vesselBoxFeature);
  
  console.log('🟢 GREEN BOX ADDED! Check map for visibility.');
  console.log('🟢 Box should be bright green with thick border around F and B points');
  
  // Force map refresh
  map.render();
  console.log('🟢 Map render forced!');
  
  // Update status display
  updateStatus(currentHeading, distance, length, width);
  
  console.log('✅ Real GPS vessel box created successfully!');
}

// Update status display and UI
function updateStatus(heading, distance, length, width) {
  document.getElementById('heading').textContent = heading.toFixed(1) + '°';
  document.getElementById('distance').textContent = distance.toFixed(2) + 'm';
  document.getElementById('box-size').textContent = `${length}ft x ${width}ft`;
  document.getElementById('path-points').textContent = pathPoints.length.toString();
  document.getElementById('added-points').textContent = addedPoints.length.toString();
  document.getElementById('speed').textContent = currentSpeed.toFixed(2) + 'mph';
}

function updateUI() {
  // Update GPS status
  const roverStatus = document.getElementById('rover-status');
  const baseStatus = document.getElementById('base-status');
  const roverCoords = document.getElementById('rover-coords');
  const baseCoords = document.getElementById('base-coords');
  const trackingStatus = document.getElementById('tracking-status');
  const connectionStatus = document.getElementById('connection-status');
  
  if (roverStatus) {
    roverStatus.textContent = roverGPS.fix ? 'Fix' : 'No Fix';
    roverStatus.style.color = roverGPS.fix ? '#2ecc71' : '#e74c3c';
  }
  
  if (baseStatus) {
    baseStatus.textContent = baseGPS.fix ? 'Fix' : 'No Fix';
    baseStatus.style.color = baseGPS.fix ? '#2ecc71' : '#e74c3c';
  }
  
  if (roverCoords && roverGPS.fix) {
    roverCoords.textContent = `${roverGPS.lat.toFixed(6)}, ${roverGPS.lng.toFixed(6)}`;
  }
  
  if (baseCoords && baseGPS.fix) {
    baseCoords.textContent = `${baseGPS.lat.toFixed(6)}, ${baseGPS.lng.toFixed(6)}`;
  }
  
  if (trackingStatus) {
    trackingStatus.textContent = isTracking ? 'Active' : 'Stopped';
    trackingStatus.style.color = isTracking ? '#2ecc71' : '#e74c3c';
  }
  
  // Update connection status
  if (connectionStatus) {
    if (isReconnecting) {
      connectionStatus.textContent = 'Reconnecting...';
      connectionStatus.style.color = '#f39c12'; // Orange
    } else if (roverGPS.fix && baseGPS.fix) {
      connectionStatus.textContent = 'Connected';
      connectionStatus.style.color = '#2ecc71'; // Green
    } else if (roverGPS.fix || baseGPS.fix) {
      connectionStatus.textContent = 'Partial';
      connectionStatus.style.color = '#f39c12'; // Orange
    } else {
      connectionStatus.textContent = 'Disconnected';
      connectionStatus.style.color = '#e74c3c'; // Red
    }
  }
}

// Update path line
function updatePathLine() {
  if (pathPoints.length < 2) return;
  
  pathSource.clear();
  
  const coordinates = pathPoints.map(point => ol.proj.fromLonLat([point.lng, point.lat]));
  const pathFeature = new ol.Feature({
    geometry: new ol.geom.LineString(coordinates)
  });
  
  pathSource.addFeature(pathFeature);
  console.log('🛤️ Path updated with', pathPoints.length, 'points');
}

// Start tracking
function startTracking() {
  isTracking = true;
  console.log('📍 Tracking started');
  updateUI();
}

// Stop tracking  
function stopTracking() {
  isTracking = false;
  console.log('⏸️ Tracking stopped');
  updateUI();
}

// Add point - creates transparent green box at current vessel position
function addPoint() {
  if (!roverGPS.fix || !baseGPS.fix) {
    console.log('❌ Cannot add point - no GPS fix');
    return;
  }

  console.log('📍 Adding point at current vessel position (centered, new method)...');

  // Get current vessel center position
  const centerLat = (roverGPS.lat + baseGPS.lat) / 2;
  const centerLng = (roverGPS.lng + baseGPS.lng) / 2;

  // Get vessel dimensions
  const lengthFeet = parseFloat(document.getElementById('vessel-length').value) || 40;
  const widthFeet = parseFloat(document.getElementById('vessel-width').value) || 16;
  const lengthMeters = lengthFeet * 0.3048;
  const widthMeters = widthFeet * 0.3048;

  // Calculate heading from base to rover
  const heading = calculateBearing(roverGPS.lat, roverGPS.lng, baseGPS.lat, baseGPS.lng);
  const headingRad = (heading * Math.PI) / 180;

  // Rectangle is centered at centerLat/centerLng, lengthMeters long, widthMeters wide, rotated by headingRad
  const halfLength = lengthMeters / 2;
  const halfWidth = widthMeters / 2;
  const cornersLocal = [
    { x: -halfLength, y: -halfWidth },
    { x: -halfLength, y: halfWidth },
    { x: halfLength, y: halfWidth },
    { x: halfLength, y: -halfWidth }
  ];

  // Convert local offsets to lat/lng
  const earthRadius = 6378137; // meters
  const degToRad = Math.PI / 180;
  const radToDeg = 180 / Math.PI;
  function offsetToLatLng(lat, lng, xForward, yLeft) {
    const dLat = (xForward * Math.cos(headingRad) - yLeft * Math.sin(headingRad)) / earthRadius;
    const dLng = (xForward * Math.sin(headingRad) + yLeft * Math.cos(headingRad)) / (earthRadius * Math.cos(lat * degToRad));
    return [
      lng + dLng * radToDeg,
      lat + dLat * radToDeg
    ];
  }
  const corners = cornersLocal.map(corner => offsetToLatLng(centerLat, centerLng, corner.x, corner.y));
  corners.push(corners[0]);

  // Convert to map projection
  const projectedCorners = corners.map(corner => ol.proj.fromLonLat(corner));

  // Create the transparent green box feature
  const addedPointFeature = new ol.Feature({
    geometry: new ol.geom.Polygon([projectedCorners]),
    timestamp: new Date().toISOString(),
    position: { lat: centerLat, lng: centerLng },
    heading: heading
  });

  // Add to source and array
  addedPointsSource.addFeature(addedPointFeature);
  addedPoints.push({
    lat: centerLat,
    lng: centerLng,
    heading: heading,
    timestamp: new Date().toISOString()
  });

  console.log('✅ Point added! Total points:', addedPoints.length);
  console.log('📍 Point position:', { lat: centerLat.toFixed(6), lng: centerLng.toFixed(6), heading: heading.toFixed(1) });

  // Update UI
  updateUI();
}

// Clear all features
function clearAll() {
  pointsSource.clear();
  vesselBoxSource.clear();
  pathSource.clear();
  addedPointsSource.clear();
  pathPoints = [];
  addedPoints = [];
  console.log('🧹 Cleared all features, path, and added points');
  updateUI();
}

// Center map on vessel
function centerMap() {
  centerMapOnVessel();
}

// Center map on vessel (internal function)
function centerMapOnVessel() {
  if (roverGPS.fix && baseGPS.fix) {
    const centerLat = (roverGPS.lat + baseGPS.lat) / 2;
    const centerLng = (roverGPS.lng + baseGPS.lng) / 2;
    map.getView().setCenter(ol.proj.fromLonLat([centerLng, centerLat]));
    map.getView().setZoom(18);
    console.log('🎯 Centered map on vessel at:', centerLat.toFixed(6), centerLng.toFixed(6));
  } else {
    console.log('❌ Cannot center - no GPS fix');
  }
}

// Create a properly calibrated vessel box
function createCalibratedVesselBox() {
  if (!roverGPS.fix || !baseGPS.fix) return;
  
  console.log('🟢 CREATING PROPERLY CALIBRATED VESSEL BOX');
  
  // Clear existing box
  vesselBoxSource.clear();
  
  // Get vessel dimensions from inputs
  const lengthFeet = parseFloat(document.getElementById('vessel-length').value) || 40;
  const widthFeet = parseFloat(document.getElementById('vessel-width').value) || 16;
  
  console.log('📏 Vessel dimensions:', lengthFeet + 'ft x ' + widthFeet + 'ft');
  
  // Convert feet to degrees (approximate)
  // 1 degree latitude ≈ 364,000 feet
  // 1 degree longitude ≈ 364,000 * cos(latitude) feet
  const avgLat = (roverGPS.lat + baseGPS.lat) / 2;
  const lengthDegrees = lengthFeet / 364000; // Length in degrees
  const widthDegrees = widthFeet / (364000 * Math.cos(avgLat * Math.PI / 180)); // Width in degrees
  
  console.log('📏 Converted to degrees:', lengthDegrees.toFixed(8) + '° x ' + widthDegrees.toFixed(8) + '°');
  
  // Center the box between F and B points
  const centerLat = (roverGPS.lat + baseGPS.lat) / 2;
  const centerLng = (roverGPS.lng + baseGPS.lng) / 2;
  
  // Calculate heading from rover to base
  const heading = calculateBearing(roverGPS.lat, roverGPS.lng, baseGPS.lat, baseGPS.lng);
  const headingRad = (heading * Math.PI) / 180;
  
  console.log('🧭 Heading:', heading.toFixed(1) + '°');
  console.log('📐 Center:', centerLat.toFixed(6) + ', ' + centerLng.toFixed(6));
  
  // Calculate box corners relative to center
  const halfLength = lengthDegrees / 2;
  const halfWidth = widthDegrees / 2;
  
  // Define corners before rotation (relative to center)
  const corners = [
    { x: -halfLength, y: -halfWidth }, // Bottom left
    { x: halfLength, y: -halfWidth },  // Bottom right
    { x: halfLength, y: halfWidth },   // Top right
    { x: -halfLength, y: halfWidth }   // Top left
  ];
  
  // Rotate corners based on heading
  const rotatedCorners = corners.map((corner) => {
    const rotatedX = corner.x * Math.cos(headingRad) - corner.y * Math.sin(headingRad);
    const rotatedY = corner.x * Math.sin(headingRad) + corner.y * Math.cos(headingRad);
    
    return [
      centerLng + rotatedX, // longitude
      centerLat + rotatedY  // latitude
    ];
  });
  
  // Close the polygon
  rotatedCorners.push(rotatedCorners[0]);
  
  console.log('🟢 Calibrated box corners:', rotatedCorners);
  
  // Convert to map projection
  const projectedCorners = rotatedCorners.map(corner => ol.proj.fromLonLat(corner));
  
  const vesselBoxFeature = new ol.Feature({
    geometry: new ol.geom.Polygon([projectedCorners])
  });
  
  vesselBoxSource.addFeature(vesselBoxFeature);
  console.log('🟢 CALIBRATED VESSEL BOX ADDED!');
  
  // Force refresh
  map.render();
}

// Create a properly calibrated vessel box with smoothed heading
function createCalibratedVesselBoxWithHeading(smoothedHeading) {
  if (!roverGPS.fix || !baseGPS.fix) return;

  console.log('🟢 CREATING SMOOTHED VESSEL BOX (centered, base/rover offset 0.5m)');

  // Clear existing box
  vesselBoxSource.clear();

  // Get vessel dimensions from inputs
  const lengthFeet = parseFloat(document.getElementById('vessel-length').value) || 40;
  const widthFeet = parseFloat(document.getElementById('vessel-width').value) || 16;

  // Convert feet to meters
  const lengthMeters = lengthFeet * 0.3048;
  const widthMeters = widthFeet * 0.3048;

  // Heading in radians (from base to rover)
  const headingRad = (smoothedHeading * Math.PI) / 180;

  // The physical center of the boat is halfway between base and rover, but base is 0.5m behind center, rover is 0.5m ahead
  // So, the center is at (base + rover)/2
  const centerLat = (baseGPS.lat + roverGPS.lat) / 2;
  const centerLng = (baseGPS.lng + roverGPS.lng) / 2;

  // Rectangle is centered at centerLat/centerLng, lengthMeters long, widthMeters wide, rotated by headingRad
  // Local rectangle corners (relative to center):
  const halfLength = lengthMeters / 2;
  const halfWidth = widthMeters / 2;
  const cornersLocal = [
    { x: -halfLength, y: -halfWidth }, // rear left
    { x: -halfLength, y: halfWidth },  // rear right
    { x: halfLength, y: halfWidth },   // front right
    { x: halfLength, y: -halfWidth }   // front left
  ];

  // Convert local offsets to lat/lng
  const earthRadius = 6378137; // meters
  const degToRad = Math.PI / 180;
  const radToDeg = 180 / Math.PI;

  function offsetToLatLng(lat, lng, xForward, yLeft) {
    // Move xForward meters in heading direction, yLeft meters left of heading
    const dLat = (xForward * Math.cos(headingRad) - yLeft * Math.sin(headingRad)) / earthRadius;
    const dLng = (xForward * Math.sin(headingRad) + yLeft * Math.cos(headingRad)) / (earthRadius * Math.cos(lat * degToRad));
    return [
      lng + dLng * radToDeg,
      lat + dLat * radToDeg
    ];
  }

  const corners = cornersLocal.map(corner => offsetToLatLng(centerLat, centerLng, corner.x, corner.y));
  corners.push(corners[0]); // close polygon

  // Convert to map projection
  const projectedCorners = corners.map(corner => ol.proj.fromLonLat(corner));

  const vesselBoxFeature = new ol.Feature({
    geometry: new ol.geom.Polygon([projectedCorners])
  });

  vesselBoxSource.addFeature(vesselBoxFeature);

  // Force refresh
  map.render();
}

// Initialize GPS reader with reconnection logic
function initGPSReader() {
  try {
    const primaryPort = configdata.primaryGpsPort;
    const secondaryPort = configdata.secondaryGpsPort;
    const baudRate = configdata.gpsBaudRate || 9600;
    
    // Check if ports are configured
    if (!primaryPort || !secondaryPort) {
      console.error("❌ GPS ports not configured in config.json");
      console.error("❌ Please set primaryGpsPort and secondaryGpsPort in config.json");
      return;
    }
    
    console.log(`🛰️ Initializing dual u-blox GPS: ${primaryPort} (Rover) & ${secondaryPort} (Base) @ ${baudRate} baud`);
    
    gpsReader = new DualUbloxReader(primaryPort, secondaryPort, baudRate);

    // Data events
    gpsReader.on('dual-data', (data) => {
      const primary = data.primary;   // Rover (F)
      const secondary = data.secondary; // Base (B)
      
      // Clear reconnection interval if we're getting data
      if (reconnectInterval) {
        console.log('📶 GPS data received - stopping reconnection attempts');
        clearInterval(reconnectInterval);
        reconnectInterval = null;
        isReconnecting = false;
      }
      
      updateDualGPS(primary, secondary);
    });

    // Connection events
    gpsReader.on('primary-connect', () => {
      console.log('✅ Rover GPS connected');
    });

    gpsReader.on('secondary-connect', () => {
      console.log('✅ Base GPS connected');
    });

    // Disconnection events
    gpsReader.on('primary-disconnect', () => {
      console.log('❌ Rover GPS disconnected');
      roverGPS.fix = false;
      startReconnectionAttempts();
    });

    gpsReader.on('secondary-disconnect', () => {
      console.log('❌ Base GPS disconnected');
      baseGPS.fix = false;
      startReconnectionAttempts();
    });

    // Error events
    gpsReader.on('error', (error) => {
      console.error('❌ GPS Reader Error:', error);
      startReconnectionAttempts();
    });

    // Connect to GPS receivers
    gpsReader.connect();
    
  } catch (error) {
    console.error("❌ Failed to initialize GPS reader:", error);
    startReconnectionAttempts();
  }
}

// Start GPS reconnection attempts
function startReconnectionAttempts() {
  if (isReconnecting) {
    console.log('🔄 Already attempting reconnection...');
    return;
  }
  
  console.log('🔄 Starting GPS reconnection attempts...');
  isReconnecting = true;
  
  // Clear any existing interval
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
  }
  
  // Try to reconnect every 5 seconds
  reconnectInterval = setInterval(() => {
    console.log('🔄 Attempting GPS reconnection...');
    
    try {
      // Dispose of old reader if it exists
      if (gpsReader) {
        try {
          gpsReader.disconnect();
        } catch (e) {
          console.log('⚠️ Error disposing old GPS reader:', e.message);
        }
      }
      
      // Create new GPS reader
      initGPSReader();
      
    } catch (error) {
      console.error('❌ Reconnection attempt failed:', error);
    }
  }, 5000); // Try every 5 seconds
  
  console.log('🔄 Reconnection attempts started (every 5 seconds)');
}

// Stop reconnection attempts
function stopReconnectionAttempts() {
  if (reconnectInterval) {
    console.log('⏹️ Stopping GPS reconnection attempts');
    clearInterval(reconnectInterval);
    reconnectInterval = null;
    isReconnecting = false;
  }
}

// Export tracking data and map image
function exportTrackingData() {
  if (pathPoints.length === 0 && addedPoints.length === 0) {
    console.log('❌ No tracking data to export');
    alert('No tracking data available. Please start tracking or add some points first.');
    return;
  }
  
  console.log('📤 Exporting tracking data and map image...');
  
  try {
    // Create timestamp for filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `vessel-track-${timestamp}`;
    
    // Prepare tracking data
    const trackingData = {
      timestamp: new Date().toISOString(),
      vesselDimensions: {
        length: vesselLength,
        width: vesselWidth,
        unit: 'feet'
      },
      pathPoints: pathPoints.map(point => ({
        lat: point.lat,
        lng: point.lng,
        timestamp: point.timestamp || new Date().toISOString()
      })),
      addedPoints: addedPoints.map(point => ({
        lat: point.lat,
        lng: point.lng,
        heading: point.heading,
        timestamp: point.timestamp
      })),
      statistics: {
        totalPathPoints: pathPoints.length,
        totalAddedPoints: addedPoints.length,
        trackingDuration: pathPoints.length > 0 ? 'N/A' : 'N/A' // Could calculate if we stored start time
      }
    };
    
    // Save JSON data
    const jsonData = JSON.stringify(trackingData, null, 2);
    saveToFile(`${filename}.json`, jsonData, 'application/json');
    
    // Export map image
    exportMapImage(filename);
    
    console.log('✅ Export completed successfully!');
    
  } catch (error) {
    console.error('❌ Export failed:', error);
    alert('Export failed: ' + error.message);
  }
}

// Export map as image with full tracking data
function exportMapImage(filename) {
  try {
    console.log('🖼️ Generating complete tracking map image...');
    
    // Store current map state
    const currentCenter = map.getView().getCenter();
    const currentZoom = map.getView().getZoom();
    
    // Calculate bounds for all tracking data
    const bounds = calculateTrackingBounds();
    if (!bounds) {
      console.error('❌ No tracking data to export');
      return;
    }
    
    console.log('📍 Tracking bounds:', bounds);
    
    // Set map view to show all tracking data
    const extent = ol.proj.transformExtent(
      [bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat],
      'EPSG:4326',
      'EPSG:3857'
    );
    
    // Add padding around the extent
    const padding = 200; // pixels
    map.getView().fit(extent, {
      padding: [padding, padding, padding, padding],
      maxZoom: 18 // Don't zoom in too much
    });
    
    console.log('🎯 Map view adjusted for full tracking data');
    
    // Show progress to user
    console.log('⏳ Waiting for high-resolution tiles to load...');
    
    // Wait longer for high-quality tiles to load
    setTimeout(() => {
      console.log('📸 Starting high-quality image capture...');
      captureMapImage(filename, currentCenter, currentZoom);
    }, 6000); // Give more time for tiles to load at new zoom level
    
  } catch (error) {
    console.error('❌ Map image export failed:', error);
  }
}

// Calculate bounds that include all tracking data
function calculateTrackingBounds() {
  const allPoints = [];
  
  // Add path points
  pathPoints.forEach(point => {
    allPoints.push({ lat: point.lat, lng: point.lng });
  });
  
  // Add added points
  addedPoints.forEach(point => {
    allPoints.push({ lat: point.lat, lng: point.lng });
  });
  
  // Add current vessel position
  if (roverGPS.fix && baseGPS.fix) {
    allPoints.push({ lat: roverGPS.lat, lng: roverGPS.lng });
    allPoints.push({ lat: baseGPS.lat, lng: baseGPS.lng });
  }
  
  if (allPoints.length === 0) {
    return null;
  }
  
  // Calculate min/max bounds
  let minLat = allPoints[0].lat;
  let maxLat = allPoints[0].lat;
  let minLng = allPoints[0].lng;
  let maxLng = allPoints[0].lng;
  
  allPoints.forEach(point => {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  });
  
  // Add some padding to the bounds
  const latPadding = (maxLat - minLat) * 0.1 || 0.001;
  const lngPadding = (maxLng - minLng) * 0.1 || 0.001;
  
  return {
    minLat: minLat - latPadding,
    maxLat: maxLat + latPadding,
    minLng: minLng - lngPadding,
    maxLng: maxLng + lngPadding,
    totalPoints: allPoints.length
  };
}

// Capture the map image after view adjustment with high quality
function captureMapImage(filename, originalCenter, originalZoom) {
  try {
    console.log('📸 Capturing high-quality map image...');
    
    // Get all map canvases (OpenLayers may use multiple layers)
    const mapContainer = document.querySelector('#map');
    const mapCanvases = mapContainer.querySelectorAll('canvas');
    
    if (mapCanvases.length === 0) {
      console.error('❌ Could not find map canvas');
      restoreMapView(originalCenter, originalZoom);
      return;
    }
    
    console.log(`🎨 Found ${mapCanvases.length} map canvas(es)`);
    
    // Get the actual map dimensions
    const mapRect = mapContainer.getBoundingClientRect();
    const mapWidth = mapRect.width;
    const mapHeight = mapRect.height;
    
    console.log(`📐 Map dimensions: ${mapWidth} x ${mapHeight}`);
    
    // Create ultra high-resolution export canvas
    const scaleFactor = 3; // 3x resolution for ultra crisp images
    const sidebarWidth = 400; // Width for side information panels
    const exportWidth = Math.round(mapWidth * scaleFactor) + (sidebarWidth * 2 * scaleFactor);
    const exportHeight = Math.round(mapHeight * scaleFactor);
    
    const exportCanvas = document.createElement('canvas');
    const ctx = exportCanvas.getContext('2d');
    
    // Set high resolution canvas
    exportCanvas.width = exportWidth;
    exportCanvas.height = exportHeight;
    
    // Enable high-quality rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    console.log(`🎯 Export canvas: ${exportWidth} x ${exportHeight} (${scaleFactor}x scale)`);
    
    // Fill with clean background
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, exportWidth, exportHeight);
    
    // Calculate map position (centered with sidebars)
    const mapStartX = sidebarWidth * scaleFactor;
    const mapWidth_scaled = Math.round(mapWidth * scaleFactor);
    const mapHeight_scaled = Math.round(mapHeight * scaleFactor);
    
    console.log(`🗺️ Map will be positioned at: ${mapStartX}, 0 with size ${mapWidth_scaled} x ${mapHeight_scaled}`);
    
    // Draw all map canvases in the center area
    mapCanvases.forEach((canvas, index) => {
      if (canvas.width > 0 && canvas.height > 0) {
        console.log(`🖼️ Drawing canvas ${index + 1}: ${canvas.width} x ${canvas.height}`);
        
        // Draw the map canvas in the center area between sidebars
        ctx.drawImage(
          canvas,
          0, 0, canvas.width, canvas.height,
          mapStartX, 0, mapWidth_scaled, mapHeight_scaled
        );
      }
    });
    
    // Add side panel overlays with tracking data
    addSidePanelOverlays(ctx, exportWidth, exportHeight, scaleFactor, sidebarWidth, filename);
    
    // Convert to blob with maximum quality
    exportCanvas.toBlob((blob) => {
      if (blob) {
        saveToFile(`${filename}.png`, blob, 'image/png');
        console.log('✅ High-quality tracking map exported successfully!');
        console.log(`📊 Final image size: ${exportWidth} x ${exportHeight} pixels`);
      } else {
        console.error('❌ Failed to create image blob');
      }
      
      // Restore original map view
      restoreMapView(originalCenter, originalZoom);
    }, 'image/png', 1.0); // Maximum quality
    
  } catch (error) {
    console.error('❌ High-quality map capture failed:', error);
    restoreMapView(originalCenter, originalZoom);
  }
}

// Restore original map view
function restoreMapView(center, zoom) {
  try {
    map.getView().setCenter(center);
    map.getView().setZoom(zoom);
    console.log('🔄 Map view restored to original position');
  } catch (error) {
    console.error('❌ Failed to restore map view:', error);
  }
}

// Add side panel overlays with tracking data for clear map visibility
function addSidePanelOverlays(ctx, width, height, scaleFactor, sidebarWidth, filename) {
  // Calculate tracking statistics
  const trackingStats = calculateTrackingStatistics();
  
  // Scale all dimensions and fonts
  const s = scaleFactor;
  const panelWidth = sidebarWidth * s;
  
  // Enable text anti-aliasing
  ctx.textBaseline = 'top';
  ctx.textRenderingOptimization = 'optimizeQuality';
  
  // LEFT PANEL - Main Information
  ctx.fillStyle = 'rgba(0, 30, 60, 0.95)'; // Dark blue background
  ctx.fillRect(0, 0, panelWidth, height);
  
  // Left panel border
  ctx.strokeStyle = '#00ff00';
  ctx.lineWidth = 3 * s;
  ctx.strokeRect(0, 0, panelWidth, height);
  
  // LEFT PANEL CONTENT
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  
  let yPos = 30 * s;
  const lineHeight = 35 * s;
  const margin = 20 * s;
  
  // Title
  ctx.font = `bold ${28 * s}px Arial, sans-serif`;
  ctx.fillStyle = '#00ff00';
  ctx.fillText('🛥️ VESSEL', margin, yPos);
  yPos += lineHeight;
  ctx.fillText('TRACKING', margin, yPos);
  yPos += lineHeight + 10 * s;
  
  // Export info
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${16 * s}px Arial, sans-serif`;
  ctx.fillText('📅 EXPORT INFO:', margin, yPos);
  yPos += 25 * s;
  
  ctx.font = `${14 * s}px Arial, sans-serif`;
  const exportTime = new Date().toLocaleString();
  ctx.fillText(`Date: ${exportTime.split(',')[0]}`, margin, yPos);
  yPos += 20 * s;
  ctx.fillText(`Time: ${exportTime.split(',')[1]}`, margin, yPos);
  yPos += 30 * s;
  
  // Tracking period
  ctx.font = `bold ${16 * s}px Arial, sans-serif`;
  ctx.fillText('⏱️ TRACKING PERIOD:', margin, yPos);
  yPos += 25 * s;
  
  ctx.font = `${14 * s}px Arial, sans-serif`;
  if (trackingStats.startTime && trackingStats.endTime) {
    ctx.fillText(`Start: ${trackingStats.startTime}`, margin, yPos);
    yPos += 20 * s;
    ctx.fillText(`End: ${trackingStats.endTime}`, margin, yPos);
    yPos += 20 * s;
    ctx.fillText(`Duration: ${trackingStats.duration}`, margin, yPos);
  } else {
    ctx.fillText('No tracking data', margin, yPos);
  }
  yPos += 30 * s;
  
  // Vessel specifications
  ctx.font = `bold ${16 * s}px Arial, sans-serif`;
  ctx.fillText('🛥️ VESSEL SPECS:', margin, yPos);
  yPos += 25 * s;
  
  ctx.font = `${14 * s}px Arial, sans-serif`;
  ctx.fillText(`Length: ${vesselLength} ft`, margin, yPos);
  yPos += 20 * s;
  ctx.fillText(`Width: ${vesselWidth} ft`, margin, yPos);
  yPos += 30 * s;
  
  // GPS Configuration
  ctx.font = `bold ${16 * s}px Arial, sans-serif`;
  ctx.fillText('🛰️ GPS CONFIG:', margin, yPos);
  yPos += 25 * s;
  
  ctx.font = `${14 * s}px Arial, sans-serif`;
  ctx.fillText(`Primary: ${configdata.primaryGpsPort || 'N/A'}`, margin, yPos);
  yPos += 20 * s;
  ctx.fillText(`Secondary: ${configdata.secondaryGpsPort || 'N/A'}`, margin, yPos);
  yPos += 20 * s;
  ctx.fillText(`Baud Rate: ${configdata.gpsBaudRate || 'N/A'}`, margin, yPos);
  
  // RIGHT PANEL - Statistics and Path Info
  const rightPanelX = width - panelWidth;
  ctx.fillStyle = 'rgba(60, 30, 0, 0.95)'; // Dark brown background
  ctx.fillRect(rightPanelX, 0, panelWidth, height);
  
  // Right panel border
  ctx.strokeStyle = '#ff6600';
  ctx.lineWidth = 3 * s;
  ctx.strokeRect(rightPanelX, 0, panelWidth, height);
  
  // RIGHT PANEL CONTENT
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  
  yPos = 30 * s;
  
  // Statistics title
  ctx.font = `bold ${28 * s}px Arial, sans-serif`;
  ctx.fillStyle = '#ff6600';
  ctx.fillText('📊 TRACKING', rightPanelX + margin, yPos);
  yPos += lineHeight;
  ctx.fillText('STATISTICS', rightPanelX + margin, yPos);
  yPos += lineHeight + 10 * s;
  
  // Path statistics
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${16 * s}px Arial, sans-serif`;
  ctx.fillText('📍 PATH DATA:', rightPanelX + margin, yPos);
  yPos += 25 * s;
  
  ctx.font = `${14 * s}px Arial, sans-serif`;
  ctx.fillText(`Path Points: ${pathPoints.length}`, rightPanelX + margin, yPos);
  yPos += 20 * s;
  ctx.fillText(`Added Points: ${addedPoints.length}`, rightPanelX + margin, yPos);
  yPos += 20 * s;
  ctx.fillText(`Total Distance: ${trackingStats.totalDistance}`, rightPanelX + margin, yPos);
  yPos += 20 * s;
  ctx.fillText(`Avg Speed: ${trackingStats.avgSpeed}`, rightPanelX + margin, yPos);
  yPos += 30 * s;
  
  // Coordinates
  if (pathPoints.length > 0) {
    ctx.font = `bold ${16 * s}px Arial, sans-serif`;
    ctx.fillText('📍 COORDINATES:', rightPanelX + margin, yPos);
    yPos += 25 * s;
    
    ctx.font = `${14 * s}px Arial, sans-serif`;
    ctx.fillText('🟢 START POSITION:', rightPanelX + margin, yPos);
    yPos += 20 * s;
    ctx.fillText(`${trackingStats.startCoords}`, rightPanelX + margin, yPos);
    yPos += 25 * s;
    
    ctx.fillText('🔴 END POSITION:', rightPanelX + margin, yPos);
    yPos += 20 * s;
    ctx.fillText(`${trackingStats.endCoords}`, rightPanelX + margin, yPos);
    yPos += 30 * s;
  }
  
  // Legend at bottom of right panel
  ctx.font = `bold ${16 * s}px Arial, sans-serif`;
  ctx.fillText('🗺️ MAP LEGEND:', rightPanelX + margin, height - 200 * s);
  
  ctx.font = `${13 * s}px Arial, sans-serif`;
  const legendItems = [
    '🟢 Green Path = Vessel Track',
    '🟢 Green Boxes = Added Points',
    '🔴 F = Front GPS (Rover)',
    '🔵 B = Back GPS (Base)',
    '🟢 Green Rectangle = Current Vessel'
  ];
  
  legendItems.forEach((item, index) => {
    ctx.fillText(item, rightPanelX + margin, height - 170 * s + (index * 18 * s));
  });
  
  // Reset text align and baseline
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// Legacy function for backwards compatibility
function addTrackingOverlay(ctx, width, height, filename) {
  addHighQualityTrackingOverlay(ctx, width, height, 1, filename);
}

// Calculate comprehensive tracking statistics
function calculateTrackingStatistics() {
  const stats = {
    startTime: null,
    endTime: null,
    duration: null,
    totalDistance: '0.00 mi',
    avgSpeed: '0.00 mph',
    startCoords: '--',
    endCoords: '--'
  };
  
  if (pathPoints.length === 0) {
    return stats;
  }
  
  // Time information
  const firstPoint = pathPoints[0];
  const lastPoint = pathPoints[pathPoints.length - 1];
  
  if (firstPoint.timestamp && lastPoint.timestamp) {
    const startTime = new Date(firstPoint.timestamp);
    const endTime = new Date(lastPoint.timestamp);
    
    stats.startTime = startTime.toLocaleTimeString();
    stats.endTime = endTime.toLocaleTimeString();
    
    const durationMs = endTime - startTime;
    const durationMinutes = Math.round(durationMs / 60000);
    stats.duration = `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`;
  }
  
  // Distance calculation
  let totalDistanceMeters = 0;
  for (let i = 1; i < pathPoints.length; i++) {
    const dist = calculateDistance(
      pathPoints[i-1].lat, pathPoints[i-1].lng,
      pathPoints[i].lat, pathPoints[i].lng
    );
    totalDistanceMeters += dist;
  }
  
  const totalDistanceMiles = totalDistanceMeters * 0.000621371;
  stats.totalDistance = totalDistanceMiles.toFixed(2) + ' mi';
  
  // Average speed
  if (firstPoint.timestamp && lastPoint.timestamp) {
    const startTime = new Date(firstPoint.timestamp);
    const endTime = new Date(lastPoint.timestamp);
    const durationHours = (endTime - startTime) / (1000 * 60 * 60);
    
    if (durationHours > 0) {
      const avgSpeedMph = totalDistanceMiles / durationHours;
      stats.avgSpeed = avgSpeedMph.toFixed(2) + ' mph';
    }
  }
  
  // Coordinates
  stats.startCoords = `${firstPoint.lat.toFixed(4)}, ${firstPoint.lng.toFixed(4)}`;
  stats.endCoords = `${lastPoint.lat.toFixed(4)}, ${lastPoint.lng.toFixed(4)}`;
  
  return stats;
}

// Legacy function for backwards compatibility
function addMapOverlay(ctx, width, height, filename) {
  addTrackingOverlay(ctx, width, height, filename);
}

// Save data to file
function saveToFile(filename, data, mimeType) {
  try {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    // Create temporary download link
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = filename;
    downloadLink.style.display = 'none';
    
    // Trigger download
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    
    // Clean up URL
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    
    console.log('💾 File saved:', filename);
    
  } catch (error) {
    console.error('❌ File save failed:', error);
    throw error;
  }
}

// Update UI with config values
function updateUIWithConfig() {
  try {
    // Update vessel dimension input fields with config values
    const lengthInput = document.getElementById('vessel-length');
    const widthInput = document.getElementById('vessel-width');
    
    if (lengthInput && vesselLength) {
      lengthInput.value = vesselLength;
    }
    
    if (widthInput && vesselWidth) {
      widthInput.value = vesselWidth;
    }
    
    console.log('🎛️ UI updated with config values');
    
  } catch (error) {
    console.error('❌ Failed to update UI with config:', error);
  }
}

// Initialize when page loads
document.addEventListener("DOMContentLoaded", () => {
  console.log('🚀 Real GPS two-point test starting...');
  
  // Update UI with config values
  updateUIWithConfig();
  
  // Initialize map
  initMap();
  
  // Initialize GPS reader
  initGPSReader();
  
  // Hook up buttons
  document.getElementById('start-tracking').onclick = startTracking;
  document.getElementById('stop-tracking').onclick = stopTracking;
  document.getElementById('add-point').onclick = addPoint;
  document.getElementById('export-data').onclick = exportTrackingData;
  document.getElementById('clear-all').onclick = clearAll;
  document.getElementById('center-map').onclick = centerMap;
  
  // Auto-update when dimensions change
  ['vessel-length', 'vessel-width'].forEach(id => {
    const input = document.getElementById(id);
    input.addEventListener('change', () => {
      if (roverGPS.fix && baseGPS.fix) {
        createVesselBox(); // Auto-recreate box when dimensions change
      }
    });
  });
  
  console.log('✅ Real GPS application initialized!');
});

// Cleanup when window is closed
window.addEventListener('beforeunload', () => {
  console.log('🧹 Cleaning up GPS connections...');
  
  // Stop reconnection attempts
  stopReconnectionAttempts();
  
  // Disconnect GPS reader
  if (gpsReader) {
    try {
      gpsReader.disconnect();
    } catch (error) {
      console.log('⚠️ Error disconnecting GPS reader:', error);
    }
  }
  
  console.log('✅ Cleanup complete');
});
