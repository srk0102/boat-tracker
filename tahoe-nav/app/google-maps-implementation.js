// Google Maps Implementation for Vessel Navigation System
// This replaces the Mapbox implementation with Google Maps for better zoom visibility

// Global variables for Google Maps
var map; // Google Maps Map Object
var vessel; // Vessel marker
var vesselBoxes = []; // Array of vessel box polygons
var currentVesselBox = null; // Current vessel box
var previousVesselBoxes = []; // Previous vessel boxes
var zone; // Treatment zone polygon
var path; // Generated treatment path
var trackedPath; // Path where vessel has been
var isClearing = false; // Flag to prevent vessel creation during clearing
var suppressPathCreation = false; // hard-stop creating new path boxes until explicitly resumed

// Vessel box configuration - fixed 14x38 feet (converted to meters)
var VESSEL_BOX_LENGTH = 38 * 0.3048; // 38 feet to meters
var VESSEL_BOX_WIDTH = 14 * 0.3048;  // 14 feet to meters

// Water detection system
var isInWater = true; // Current water status
var landTime = 0; // Time spent on land (milliseconds)
var waterTime = 0; // Time spent in water (milliseconds)
var lastWaterCheck = Date.now(); // Last water check time
var landThreshold = 20000; // 20 seconds in milliseconds
var lastSailingStatus = null; // Track last status to prevent unnecessary updates
var currentBoatColor = null; // Track current boat color to prevent unnecessary updates
var currentFrontColor = null; // Track current front indicator color to prevent blinking

// Path drawing system
var boatPath = []; // Array of path points with water status
var pathPolyline = null; // Single polyline for the entire path
var maxPathPoints = 100; // Maximum number of path points to keep
var pathCounter = 0; // Counter for path rectangles
var pathPoints = []; // Array of path points for red line
var lastVesselPosition = null; // Last position where a vessel rectangle was created
var vesselCreationDistance = 1.0; // Create vessel every 1 meter (in meters)

// Function to check if map is ready
function isMapReady() {
  return map && typeof google !== 'undefined' && google.maps;
}

// Calculate distance between two points in meters
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Load boat dimensions from config (simplified)
function loadBoatDimensions(config) {
  if (config && config.boatDimensions) {
    VESSEL_BOX_LENGTH = config.boatDimensions.length;
    VESSEL_BOX_WIDTH = config.boatDimensions.width;
    
    // Convert to meters if needed
    if (config.boatDimensions.unit === 'feet') {
      VESSEL_BOX_LENGTH = VESSEL_BOX_LENGTH * 0.3048; // feet to meters
      VESSEL_BOX_WIDTH = VESSEL_BOX_WIDTH * 0.3048;   // feet to meters
    }
  }
}

// Get fixed 16x40 meter box size
function getFixedBoxSize() {
  return { length: VESSEL_BOX_LENGTH, width: VESSEL_BOX_WIDTH };
}

// Clear the boat path (now just clears transparent boxes)
function clearBoatPath() {
  return clearVesselBoxes({ keepCurrent: true, keepPolyline: false });
}
// Initialize Google Maps
function initMap() {
  
  const mapElement = document.getElementById("map");
  if (!mapElement) {
    console.error('❌ Map container not found!');
    return;
  }

  try {
    // Initialize Google Maps with satellite view
    map = new google.maps.Map(mapElement, {
      center: { lat: 37.3382, lng: -121.8863 }, // San Jose coordinates
      zoom: 18,
      mapTypeId: google.maps.MapTypeId.SATELLITE,
      mapId: window.configdata?.mapId || 'DEMO_MAP_ID', // Map ID from config for Advanced Markers
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true,
      scaleControl: true,
      rotateControl: false,
      tilt: 0 // Flat view
    });

    // Make map globally accessible for sidebar functions
    window.map = map;
    
    // Wait for map to load
    
    // No zoom change listener needed - box size is fixed
    
  } catch (error) {
    console.error('❌ Failed to initialize Google Maps:', error);
    return;
  }

  // Add event listeners
  google.maps.event.addListener(map, 'dragstart', function () {
    centerOnPos = false;
  });

  // Add window resize listener
  window.addEventListener('resize', function() {
    if (map) {
      google.maps.event.trigger(map, 'resize');
    }
  });

}


// Create boat rectangle with front indicator using Google Maps
function createVesselBox(lat, lng, heading, type = 'current', pathNumber = null) {
    const STYLE = {
      current: { fill: 0.70, stroke: 0.90, strokeW: 3, z: 100 },
      path:    { fill: 0.26, stroke: 0.40, strokeW: 1, z: 40 } // << very light
    };
    const FRONT = {
      current: { fill: 1.00, stroke: 1.00, strokeW: 1, z: 101 },
      path:    { fill: 0.18, stroke: 0.25, strokeW: 0.5, z: 11 }
    };
  
    const boxSize = getFixedBoxSize();
    const boxLength = boxSize.length, boxWidth = boxSize.width;
    const halfLength = boxLength / 2, halfWidth = boxWidth / 2;
    const headingRad = (heading * Math.PI) / 180;
  
    const corners = [
      { x: -halfLength, y: -halfWidth },
      { x:  halfLength, y: -halfWidth },
      { x:  halfLength, y:  halfWidth },
      { x: -halfLength, y:  halfWidth }
    ];
  
    const rotatedCorners = corners.map(corner => {
      const rx = corner.x * Math.cos(headingRad) - corner.y * Math.sin(headingRad);
      const ry = corner.x * Math.sin(headingRad) + corner.y * Math.cos(headingRad);
      const latOffset = ry / 111320;
      const lngOffset = rx / (111320 * Math.cos(lat * Math.PI / 180));
      return { lat: lat + latOffset, lng: lng + lngOffset };
    });
  
    const s = STYLE[type] || STYLE.current;
    const boatPolygon = new google.maps.Polygon({
      paths: rotatedCorners,
      strokeColor: '#00FF00',
      strokeOpacity: s.stroke,
      strokeWeight: s.strokeW,
      fillColor: '#00FF00',
      fillOpacity: s.fill,
      zIndex: s.z,
      map,
      clickable: false // << cheaper & avoids hover/selection artifacts
    });
  
    // Front indicator
    const f = FRONT[type] || FRONT.current;
    const frontIndicator = new google.maps.Circle({
      center: { lat, lng },
      radius: 0.5,
      strokeColor: '#FF0000',
      strokeOpacity: f.stroke,
      strokeWeight: f.strokeW,
      fillColor: '#FF0000',
      fillOpacity: f.fill,
      zIndex: f.z,
      map,
      clickable: false
    });
  
    // Place front at bow
    const frontOffset = halfLength + 1;
    const frontX = frontOffset * Math.cos(headingRad);
    const frontY = frontOffset * Math.sin(headingRad);
    const frontLat = lat + (frontY / 111320);
    const frontLng = lng + (frontX / (111320 * Math.cos(lat * Math.PI / 180)));
    frontIndicator.setCenter({ lat: frontLat, lng: frontLng });

    // Add number label for path rectangles using AdvancedMarkerElement
    let numberLabel = null;
    if (type === 'path' && pathNumber !== null) {
      // Create a custom element for the number label
      const labelElement = document.createElement('div');
      labelElement.style.cssText = `
        width: 20px;
        height: 20px;
        background: white;
        border: 1px solid black;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
        color: black;
        z-index: 20;
      `;
      labelElement.textContent = pathNumber.toString();

      numberLabel = new google.maps.marker.AdvancedMarkerElement({
        position: { lat, lng },
        map: map,
        content: labelElement,
        zIndex: 20
      });
    }
  
    return { boat: boatPolygon, front: frontIndicator, number: numberLabel, lat, lng, heading, type, pathNumber };
}
  

// Update existing vessel box position without creating new ones
function updateVesselBoxPosition(vesselBox, lat, lng, heading) {
  if (!vesselBox || !vesselBox.boat || !vesselBox.front) return;
  
  const boxSize = getFixedBoxSize();
  const boxLength = boxSize.length;
  const boxWidth = boxSize.width;
  
  // Calculate the four corners of the rectangle
  const halfLength = boxLength / 2;
  const halfWidth = boxWidth / 2;
  
  // Convert heading to radians
  const headingRad = (heading * Math.PI) / 180;
  
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
    
    // Convert meters to degrees
    const latOffset = rotatedY / 111320;
    const lngOffset = rotatedX / (111320 * Math.cos(lat * Math.PI / 180));
    
    return { lat: lat + latOffset, lng: lng + lngOffset };
  });
  
  // Update boat polygon
  vesselBox.boat.setPath(rotatedCorners);
  
  // Update front indicator position
  const frontOffset = halfLength + 1;
  const frontX = frontOffset * Math.cos(headingRad);
  const frontY = frontOffset * Math.sin(headingRad);
  
  const frontLat = lat + (frontY / 111320);
  const frontLng = lng + (frontX / (111320 * Math.cos(lat * Math.PI / 180)));
  
  vesselBox.front.setCenter({ lat: frontLat, lng: frontLng });
  
  // Update stored position
  vesselBox.lat = lat;
  vesselBox.lng = lng;
  vesselBox.heading = heading;
}

// Update vessel box position
function updateVesselBox(lat, lng, heading) {
  if (!isMapReady()) return;

  // If we're in a clearing or we're suppressing path creation, just update the current box
  if (isClearing || suppressPathCreation || !window.isTracking) {
    if (currentVesselBox) {
      updateVesselBoxPosition(currentVesselBox, lat, lng, heading);
    } else {
      currentVesselBox = createVesselBox(lat, lng, heading, 'current');
    }
    return;
  }

  // Always add point to red path line for continuous tracking
  if (currentVesselBox) {
    pathPoints.push({ lat: currentVesselBox.lat, lng: currentVesselBox.lng });
    updateRedPathLine();
  }

  // Create vessel rectangles based on distance traveled (every 1 meter)
  if (lastVesselPosition) {
    const distance = calculateDistance(lastVesselPosition.lat, lastVesselPosition.lng, lat, lng);
    if (distance >= vesselCreationDistance) {
      if (currentVesselBox) {
        // Create path box with number
        const pathBox = createVesselBox(currentVesselBox.lat, currentVesselBox.lng, currentVesselBox.heading, 'path', pathCounter);
        previousVesselBoxes.push(pathBox);
        pathCounter++;
      }
      lastVesselPosition = { lat, lng };
    }
  } else {
    // First position - set as last vessel position
    lastVesselPosition = { lat, lng };
  }

  // Always update current vessel position (but don't create new boxes continuously)
  if (currentVesselBox) {
    updateVesselBoxPosition(currentVesselBox, lat, lng, heading);
  } else {
    currentVesselBox = createVesselBox(lat, lng, heading, 'current');
  }
}

// Update red path line
function updateRedPathLine() {
  if (pathPoints.length < 2) return;
  
  // Remove existing red path line
  if (pathPolyline) {
    pathPolyline.setMap(null);
  }
  
  // Create new red path line
  pathPolyline = new google.maps.Polyline({
    path: pathPoints,
    strokeColor: '#FF0000',
    strokeOpacity: 0.8,
    strokeWeight: 3,
    map: map,
    clickable: false,
    zIndex: 5
  });
}

// Safe remover helper
function removeVesselBox(box) {
  if (!box) return;
  try {
    if (box.boat) {
      google.maps.event.clearInstanceListeners(box.boat);
      // break geometry links to help GC
      try { box.boat.setPath([]); } catch(_){}
      box.boat.setMap(null);
      box.boat = null;
    }
    if (box.front) {
      google.maps.event.clearInstanceListeners(box.front);
      try { box.front.setRadius(0); } catch(_){}
      box.front.setMap(null);
      box.front = null;
    }
    if (box.number) {
      box.number.map = null;
      box.number = null;
    }
  } catch (e) {
    // Silent error handling
  }
}
  

// Clear path vessel boxes (previous light green boxes) but keep current vessel
function clearVesselBoxes(opts = {}) {
    const { keepCurrent = true, keepPolyline = false } = opts;
  
    // Block creation
    isClearing = true;
    suppressPathCreation = true;
  
    // 1) Snapshot and nuke previous/path boxes synchronously
    const toClear = previousVesselBoxes.slice(0);
    previousVesselBoxes.length = 0;
  
    for (let i = 0; i < toClear.length; i++) {
      // extra defensive step to avoid GL linger
      if (toClear[i]?.boat)  try { toClear[i].boat.setVisible(false); } catch(e){}
      if (toClear[i]?.front) try { toClear[i].front.setVisible(false); } catch(e){}
      removeVesselBox(toClear[i]);
    }
  
    // 2) Legacy container
    if (vesselBoxes && vesselBoxes.length) {
      const toClearLegacy = vesselBoxes.slice(0);
      vesselBoxes.length = 0;
      for (let i = 0; i < toClearLegacy.length; i++) {
        try { toClearLegacy[i].boat?.setVisible(false); } catch(e){}
        try { toClearLegacy[i].front?.setVisible(false); } catch(e){}
        removeVesselBox(toClearLegacy[i]);
      }
    }
  
    // 3) Optionally clear current
    if (!keepCurrent && currentVesselBox) {
      try { currentVesselBox.boat?.setVisible(false); } catch(e){}
      try { currentVesselBox.front?.setVisible(false); } catch(e){}
      removeVesselBox(currentVesselBox);
      currentVesselBox = null;
    }
  
    // 4) Polyline path
    if (!keepPolyline && pathPolyline) {
      try { google.maps.event.clearInstanceListeners(pathPolyline); } catch(_){}
      try { pathPolyline.setMap(null); } catch(_){}
      pathPolyline = null;
    }
  
    // 5) Clear buffers and reset counters
    boatPath.length = 0;
    pathPoints.length = 0;
    pathCounter = 0;
    lastVesselPosition = null;
  
    // 6) Clear red path line
    if (pathPolyline) {
      try { pathPolyline.setMap(null); } catch(_){}
      pathPolyline = null;
    }
  
    // 7) Force a quick reflow (simple and effective)
    if (map) {
      const z = map.getZoom();
      map.setZoom(z); // ping a redraw
    }
  
    // Keep creation suppressed until user resumes (Start)
    isClearing = false;
  }
  

// Resume path creation (call when user hits "Start tracking")
function resumePathCreation() {
  suppressPathCreation = false;
}

// Set vessel creation distance (in meters)
function setVesselCreationDistance(distanceMeters) {
  vesselCreationDistance = distanceMeters;
}

// Get current vessel creation distance
function getVesselCreationDistance() {
  return vesselCreationDistance;
}


// Update vessel position and rotation
function updateVesselPosition(lat, lng, heading, shouldCenter = false) {
  if (!isMapReady()) return;
  
  // Don't create vessels if we're in the middle of clearing
  if (isClearing) {
    return;
  }
  
  // ONLY run vessel functions if tracking is active
  if (window.isTracking) {
    // Create vessels
    updateVesselBox(lat, lng, heading);
  } else {
    // If tracking is OFF, still update current vessel position but don't create path vessels
    if (currentVesselBox) {
      // Update existing current box position
      updateVesselBoxPosition(currentVesselBox, lat, lng, heading);
    } else {
      // Create current box if none exists
      currentVesselBox = createVesselBox(lat, lng, heading, 'current');
    }
  }
  
  // Center map on vessel if requested
  if (shouldCenter) {
    map.setCenter({ lat: lat, lng: lng });
  }
}


// Get current sailing status
function getSailingStatus() {
  return {
    isInWater: isInWater,
    landTime: landTime,
    waterTime: waterTime,
    landTimeSeconds: (landTime / 1000).toFixed(1),
    waterTimeSeconds: (waterTime / 1000).toFixed(1),
    isStuck: !isInWater && landTime > landThreshold
  };
}

// Export functions for use in main application
if (typeof module !== 'undefined' && module.exports) {
module.exports = {
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
    getVesselCreationDistance
};
}
