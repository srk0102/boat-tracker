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

// ---------- Logging bridge (wired from index) ----------
let __logger = null;
function setLogger(fn) {
  __logger = typeof fn === "function" ? fn : null;
}
function logCal(msg, extra = {}) {
  const stamp = new Date().toISOString();
  const line = `[CAL] ${stamp} ${msg} ${
    Object.keys(extra).length ? JSON.stringify(extra) : ""
  }`;
  if (__logger) {
    try {
      __logger(line);
    } catch (_) {
      console.log(line);
    }
  } else {
    console.log(line);
  }
}

// ---------- Calibration/heading state ----------
let ICON_ZERO_BEARING = 0; // 0 if icon faces north, 90 if east (tunable from HUD)
let NEEDS_180_FLIP = 0; // 180 if pointer looks backwards (tunable from HUD)
let MOUNT_BIAS_DEG = 0; // fine bias if antenna line isn't perfect (tunable from HUD)

const SMOOTHING = 0.25; // angle smoothing 0..1

// Auto-zero when moving steadily
const AUTO_ZERO_SPEED_MS = 0.514444; // ~1 knot in m/s
const AUTO_ZERO_HOLD_MS = 1500; // must exceed speed for this long

// Hide dot while parked / uncalibrated
const DOT_HIDE_MIN_SPEED = 0.05; // m/s

// Re-zero after long stop (so next roll picks a fresh forward)
const STOP_SPEED_MS = 0.1; // below this we consider "stopped"
const REZERO_AFTER_STOP_MS = 120000; // 2 minutes stopped -> clear baseline

// Reverse detection when we DON'T have RTK yaw (fallback mode only)
const REVERSE_CHECK_ENABLED = true;
const REVERSE_SPEED_MPS = 6.7056; // 15 mph in m/s
const REVERSE_HOLD_MS = 1200; // must be sustained ~1.2s
const REVERSE_MIN_ANGLE_DEG = 150; // ~opposite to baseline
const REZERO_ON_REVERSE = true; // recalibrate to motion when reversing fast

let baseCourse = null; // stored at zero
let lastCourse = null; // last non-zero/valid absolute course
let lastRot = 0; // smoothed rendered rotation
let lastSpeedMs = 0; // most recent speed in m/s

let aboveSince = 0; // timer for auto-zero
let stoppedSince = 0; // timer for long-stop re-zero
let reverseSince = 0; // timer for reverse detection
let lastFrontShown = null;

const norm = (d) => ((d % 360) + 360) % 360;
const angDiff = (a, b) => ((b - a + 540) % 360) - 180;
const absAngDiff = (a, b) => Math.abs(angDiff(a, b));
const lerpAngle = (a, b, t = SMOOTHING) => norm(a + angDiff(a, b) * t);

const holdOrUpdateCourse = (c) => {
  if (typeof c !== "number" || isNaN(c) || c <= 0) return lastCourse ?? 0;
  lastCourse = c;
  return c;
};

const frontVisible = () => {
  // Hide when uncalibrated + basically stopped
  if (
    baseCourse == null &&
    lastCourse == null &&
    lastSpeedMs < DOT_HIDE_MIN_SPEED
  )
    return false;
  return true;
};

const autoZeroMaybe = (absCourse) => {
  const now = Date.now();
  if (lastSpeedMs >= AUTO_ZERO_SPEED_MS) {
    if (!aboveSince) aboveSince = now;
    if (now - aboveSince >= AUTO_ZERO_HOLD_MS) {
      const c = holdOrUpdateCourse(absCourse);
      if (baseCourse == null && typeof c === "number") {
        baseCourse = c; // set once per session
        logCal("Auto-zero set baseline", { baseCourse, lastSpeedMs });
        renderCalibrationHUD();
      }
    }
  } else {
    aboveSince = 0;
  }
};

const longStopMaybeClear = () => {
  const now = Date.now();
  if (lastSpeedMs < STOP_SPEED_MS) {
    if (!stoppedSince) stoppedSince = now;
    if (baseCourse != null && now - stoppedSince >= REZERO_AFTER_STOP_MS) {
      baseCourse = null;
      logCal("Baseline cleared after long stop", {
        stoppedMs: now - stoppedSince,
      });
      renderCalibrationHUD();
    }
  } else {
    stoppedSince = 0;
  }
};

const reverseDetectMaybeRezero = (absCourse, hasRTKHeading = false) => {
  if (!REVERSE_CHECK_ENABLED || hasRTKHeading || baseCourse == null) return;
  // If we're moving fast and facing ~opposite our baseline for long enough, re-zero to motion
  if (
    lastSpeedMs >= REVERSE_SPEED_MPS &&
    absAngDiff(baseCourse, absCourse) >= REVERSE_MIN_ANGLE_DEG
  ) {
    if (!reverseSince) reverseSince = Date.now();
    if (Date.now() - reverseSince >= REVERSE_HOLD_MS) {
      if (REZERO_ON_REVERSE) {
        baseCourse = holdOrUpdateCourse(absCourse);
        logCal("Reverse detected -> re-zero to motion", {
          baseCourse,
          speedMs: lastSpeedMs,
        });
        renderCalibrationHUD();
      }
      reverseSince = 0; // one-shot
    }
  } else {
    reverseSince = 0;
  }
};

const toDisplayHeading = (abs) => {
  const h = holdOrUpdateCourse(abs);
  const rel = baseCourse == null ? h : norm(h - baseCourse);
  return norm(rel + ICON_ZERO_BEARING + NEEDS_180_FLIP + MOUNT_BIAS_DEG);
};

// Manual helpers (also logged)
const setHeadingZero = () => {
  if (lastCourse != null) {
    baseCourse = lastCourse;
    logCal("Manual zero (Z) pressed", { baseCourse });
    renderCalibrationHUD();
  }
};
const clearHeadingZero = () => {
  baseCourse = null;
  logCal("Manual clear baseline (Shift+Z)", {});
  renderCalibrationHUD();
};

// Vessel box configuration - fixed 14x38 feet (converted to meters)
var VESSEL_BOX_LENGTH = 38 * 0.3048; // 38 feet to meters
var VESSEL_BOX_WIDTH = 14 * 0.3048; // 14 feet to meters

// Water detection system (not modified here)
var isInWater = true;
var landTime = 0;
var waterTime = 0;
var lastWaterCheck = Date.now();
var landThreshold = 20000;
var lastSailingStatus = null;
var currentBoatColor = null;
var currentFrontColor = null;

// Path drawing system
var boatPath = [];
var pathPolyline = null;
var maxPathPoints = 100;
var pathCounter = 0;
var pathPoints = [];
var lastVesselPosition = null;
var vesselCreationDistance = 1.0;

// Function to check if map is ready
function isMapReady() {
  return map && typeof google !== "undefined" && google.maps;
}

// Calculate distance between two points in meters
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Load boat dimensions from config (simplified)
function loadBoatDimensions(config) {
  if (config && config.boatDimensions) {
    VESSEL_BOX_LENGTH = config.boatDimensions.length;
    VESSEL_BOX_WIDTH = config.boatDimensions.width;
    if (config.boatDimensions.unit === "feet") {
      VESSEL_BOX_LENGTH *= 0.3048;
      VESSEL_BOX_WIDTH *= 0.3048;
    }
  }
}

// Get fixed box size
function getFixedBoxSize() {
  return { length: VESSEL_BOX_LENGTH, width: VESSEL_BOX_WIDTH };
}

// Clear the boat path (now just clears transparent boxes)
function clearBoatPath() {
  return clearVesselBoxes({ keepCurrent: true, keepPolyline: false });
}

// ---------- Calibration HUD (panel) ----------
let calibHud; // container element
function createCalibrationHUD() {
  const wrap = document.createElement("div");
  wrap.style.cssText = `
    background: #fff; color:black; padding:10px 12px; border-radius:10px;
    font-family: system-ui, Arial; font-size:12px; line-height:1.35;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3); min-width: 240px;
  `;
  wrap.innerHTML = `
    <div style="font-weight:700; margin-bottom:6px;">Calibration HUD</div>
    <div id="cal-rows">
      <div>Speed: <span id="cal-spd">0.0</span> m/s (<span id="cal-spdk">0.0</span> kn)</div>
      <div>Abs: <span id="cal-abs">--</span>° | Base: <span id="cal-base">--</span>°</div>
      <div>Rel: <span id="cal-rel">--</span>° | Render: <span id="cal-rend">--</span>°</div>
      <div>Flags: <span id="cal-flags">…</span></div>
      <div>Timers: move <span id="cal-tmov">0.0</span>s, stop <span id="cal-tstp">0.0</span>s, rev <span id="cal-trev">0.0</span>s</div>
      <div>Bias: <span id="cal-bias">0</span>° | Flip: <span id="cal-flip">0</span>° | Icon0: <span id="cal-icon">0</span>°</div>
    </div>
    <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
      <button id="cal-zero"  style="padding:4px 8px; border-radius:6px; border:0; color:"black";">Zero</button>
      <button id="cal-clear" style="padding:4px 8px; border-radius:6px; border:0; color:"black";">Clear</button>
      <button id="cal-flipb" style="padding:4px 8px; border-radius:6px; border:0; color:"black";">Flip 180</button>
      <button id="cal-bm"    style="padding:4px 8px; border-radius:6px; border:0; color:"black";">Bias −</button>
      <button id="cal-bp"    style="padding:4px 8px; border-radius:6px; border:0; color:"black";">Bias +</button>
      <button id="cal-iconb" style="padding:4px 8px; border-radius:6px; border:0; color:"black";">Icon0↺</button>
    </div>
  `;
  // Hook buttons
  wrap.querySelector("#cal-zero").onclick = () => setHeadingZero();
  wrap.querySelector("#cal-clear").onclick = () => clearHeadingZero();
  wrap.querySelector("#cal-flipb").onclick = () => {
    NEEDS_180_FLIP = NEEDS_180_FLIP ? 0 : 180;
    logCal("Flip toggled", { NEEDS_180_FLIP });
    renderCalibrationHUD();
  };
  wrap.querySelector("#cal-bm").onclick = () => {
    MOUNT_BIAS_DEG = Math.round((MOUNT_BIAS_DEG - 1) * 10) / 10;
    logCal("Bias adjusted", { MOUNT_BIAS_DEG });
    renderCalibrationHUD();
  };
  wrap.querySelector("#cal-bp").onclick = () => {
    MOUNT_BIAS_DEG = Math.round((MOUNT_BIAS_DEG + 1) * 10) / 10;
    logCal("Bias adjusted", { MOUNT_BIAS_DEG });
    renderCalibrationHUD();
  };
  wrap.querySelector("#cal-iconb").onclick = () => {
    ICON_ZERO_BEARING = (ICON_ZERO_BEARING + 90) % 360;
    logCal("Icon zero bearing rotated", { ICON_ZERO_BEARING });
    renderCalibrationHUD();
  };
  calibHud = wrap;
  map.controls[google.maps.ControlPosition.TOP_RIGHT].push(wrap);
  renderCalibrationHUD();
}

function renderCalibrationHUD() {
  if (!calibHud) return;
  const qs = (id) => calibHud.querySelector(id);
  const spd = lastSpeedMs;
  const spdk = spd / 0.514444;
  const abs = lastCourse != null ? Math.round(lastCourse) : null;
  const base = baseCourse != null ? Math.round(baseCourse) : null;
  const rel =
    lastCourse != null && baseCourse != null
      ? Math.round(norm(lastCourse - baseCourse))
      : null;
  const rend = Math.round(lastRot);
  const flags = [
    baseCourse != null ? "BASE" : "noBASE",
    frontVisible() ? "DOT" : "noDOT",
  ].join(",");

  qs("#cal-spd").textContent = spd.toFixed(2);
  qs("#cal-spdk").textContent = spdk.toFixed(2);
  qs("#cal-abs").textContent = abs == null ? "--" : abs;
  qs("#cal-base").textContent = base == null ? "--" : base;
  qs("#cal-rel").textContent = rel == null ? "--" : rel;
  qs("#cal-rend").textContent = isNaN(rend) ? "--" : rend;
  qs("#cal-flags").textContent = flags;

  const now = Date.now();
  const tmov = aboveSince ? (now - aboveSince) / 1000 : 0;
  const tstp = stoppedSince ? (now - stoppedSince) / 1000 : 0;
  const trev = reverseSince ? (now - reverseSince) / 1000 : 0;
  qs("#cal-tmov").textContent = tmov.toFixed(1);
  qs("#cal-tstp").textContent = tstp.toFixed(1);
  qs("#cal-trev").textContent = trev.toFixed(1);

  qs("#cal-bias").textContent = MOUNT_BIAS_DEG;
  qs("#cal-flip").textContent = NEEDS_180_FLIP;
  qs("#cal-icon").textContent = ICON_ZERO_BEARING;
}

// Clear the boat path (now just clears transparent boxes)
function initMap() {
  const mapElement = document.getElementById("map");
  if (!mapElement) {
    console.error("❌ Map container not found!");
    return;
  }

  try {
    map = new google.maps.Map(mapElement, {
      center: { lat: 37.3382, lng: -121.8863 },
      zoom: 18,
      mapTypeId: google.maps.MapTypeId.SATELLITE,
      mapId: window.configdata?.mapId || "DEMO_MAP_ID",
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true,
      scaleControl: true,
      rotateControl: false,
      tilt: 0,
    });

    window.map = map;

    // Calibration HUD on map
    createCalibrationHUD();
  } catch (error) {
    console.error("❌ Failed to initialize Google Maps:", error);
    return;
  }

  google.maps.event.addListener(map, "dragstart", function () {
    try {
      window.centerOnPos = false;
    } catch (_) {}
  });

  window.addEventListener("resize", function () {
    if (map) {
      google.maps.event.trigger(map, "resize");
    }
  });
}

// Create boat rectangle with front indicator using Google Maps
function createVesselBox(
  lat,
  lng,
  heading,
  type = "current",
  pathNumber = null
) {
  const STYLE = {
    current: { fill: 0.7, stroke: 0.9, strokeW: 3, z: 100 },
    path: { fill: 0.26, stroke: 0.4, strokeW: 1, z: 40 },
  };
  const FRONT = {
    current: { fill: 1.0, stroke: 1.0, strokeW: 1, z: 101 },
    path: { fill: 0.18, stroke: 0.25, strokeW: 0.5, z: 11 },
  };

  const boxSize = getFixedBoxSize();
  const boxLength = boxSize.length,
    boxWidth = boxSize.width;
  const halfLength = boxLength / 2,
    halfWidth = boxWidth / 2;

  const displayHeading = toDisplayHeading(heading);
  lastRot = lerpAngle(lastRot, displayHeading);
  const headingRad = (lastRot * Math.PI) / 180;

  const corners = [
    { x: -halfLength, y: -halfWidth },
    { x: halfLength, y: -halfWidth },
    { x: halfLength, y: halfWidth },
    { x: -halfLength, y: halfWidth },
  ];

  const rotatedCorners = corners.map((corner) => {
    const rx =
      corner.x * Math.cos(headingRad) - corner.y * Math.sin(headingRad);
    const ry =
      corner.x * Math.sin(headingRad) + corner.y * Math.cos(headingRad);
    const latOffset = ry / 111320;
    const lngOffset = rx / (111320 * Math.cos((lat * Math.PI) / 180));
    return { lat: lat + latOffset, lng: lng + lngOffset };
  });

  const s = STYLE[type] || STYLE.current;
  const boatPolygon = new google.maps.Polygon({
    paths: rotatedCorners,
    strokeColor: "#00FF00",
    strokeOpacity: s.stroke,
    strokeWeight: s.strokeW,
    fillColor: "#00FF00",
    fillOpacity: s.fill,
    zIndex: s.z,
    map,
    clickable: false,
  });

  const f = FRONT[type] || FRONT.current;
  const frontIndicator = new google.maps.Circle({
    center: { lat, lng },
    radius: 0.5,
    strokeColor: "#FF0000",
    strokeOpacity: f.stroke,
    strokeWeight: f.strokeW,
    fillColor: "#FF0000",
    fillOpacity: f.fill,
    zIndex: f.z,
    map,
    clickable: false,
  });

  // Front indicator at bow
  const frontOffset = halfLength + 1;
  const frontX = frontOffset * Math.cos(headingRad);
  const frontY = frontOffset * Math.sin(headingRad);
  const frontLat = lat + frontY / 111320;
  const frontLng = lng + frontX / (111320 * Math.cos((lat * Math.PI) / 180));
  frontIndicator.setCenter({ lat: frontLat, lng: frontLng });

  // Number label for path rectangles (optional)
  let numberLabel = null;
  if (type === "path" && pathNumber !== null) {
    const labelElement = document.createElement("div");
    labelElement.style.cssText = `
      width: 20px; height: 20px; background: white; border: 1px solid black;
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: bold; color: black; z-index: 20;`;
    labelElement.textContent = pathNumber.toString();

    numberLabel = new google.maps.marker.AdvancedMarkerElement({
      position: { lat, lng },
      map: map,
      content: labelElement,
      zIndex: 20,
    });
  }

  // Visibility with logging on toggle
  const vis = frontVisible();
  if (lastFrontShown !== vis) {
    logCal(vis ? "Dot shown" : "Dot hidden", {
      baseCourse,
      lastCourse,
      lastSpeedMs,
    });
    lastFrontShown = vis;
  }
  frontIndicator.setVisible(vis);

  return {
    boat: boatPolygon,
    front: frontIndicator,
    number: numberLabel,
    lat,
    lng,
    heading,
    type,
    pathNumber,
  };
}

// Update existing vessel box position without creating new ones
function updateVesselBoxPosition(vesselBox, lat, lng, heading) {
  if (!vesselBox || !vesselBox.boat || !vesselBox.front) return;

  const boxSize = getFixedBoxSize();
  const boxLength = boxSize.length;
  const boxWidth = boxSize.width;

  const halfLength = boxLength / 2;
  const halfWidth = boxWidth / 2;

  const displayHeading = toDisplayHeading(heading);
  lastRot = lerpAngle(lastRot, displayHeading);
  const headingRad = (lastRot * Math.PI) / 180;

  const corners = [
    { x: -halfLength, y: -halfWidth },
    { x: halfLength, y: -halfWidth },
    { x: halfLength, y: halfWidth },
    { x: -halfLength, y: halfWidth },
  ];

  const rotatedCorners = corners.map((corner) => {
    const rotatedX =
      corner.x * Math.cos(headingRad) - corner.y * Math.sin(headingRad);
    const rotatedY =
      corner.x * Math.sin(headingRad) + corner.y * Math.cos(headingRad);
    const latOffset = rotatedY / 111320;
    const lngOffset = rotatedX / (111320 * Math.cos((lat * Math.PI) / 180));
    return { lat: lat + latOffset, lng: lng + lngOffset };
  });

  vesselBox.boat.setPath(rotatedCorners);

  const frontOffset = halfLength + 1;
  const frontX = frontOffset * Math.cos(headingRad);
  const frontY = frontOffset * Math.sin(headingRad);
  const frontLat = lat + frontY / 111320;
  const frontLng = lng + frontX / (111320 * Math.cos((lat * Math.PI) / 180));
  vesselBox.front.setCenter({ lat: frontLat, lng: frontLng });

  const vis = frontVisible();
  if (lastFrontShown !== vis) {
    logCal(vis ? "Dot shown" : "Dot hidden", {
      baseCourse,
      lastCourse,
      lastSpeedMs,
    });
    lastFrontShown = vis;
  }
  vesselBox.front.setVisible(vis);

  vesselBox.lat = lat;
  vesselBox.lng = lng;
  vesselBox.heading = heading;

  renderCalibrationHUD();
}

// Update vessel box position
function updateVesselBox(lat, lng, heading) {
  if (!isMapReady()) return;

  if (isClearing || suppressPathCreation || !window.isTracking) {
    if (currentVesselBox) {
      updateVesselBoxPosition(currentVesselBox, lat, lng, heading);
    } else {
      currentVesselBox = createVesselBox(lat, lng, heading, "current");
    }
    return;
  }

  if (currentVesselBox) {
    pathPoints.push({ lat: currentVesselBox.lat, lng: currentVesselBox.lng });
    updateRedPathLine();
  }

  if (lastVesselPosition) {
    const distance = calculateDistance(
      lastVesselPosition.lat,
      lastVesselPosition.lng,
      lat,
      lng
    );
    if (distance >= vesselCreationDistance) {
      if (currentVesselBox) {
        const pathBox = createVesselBox(
          currentVesselBox.lat,
          currentVesselBox.lng,
          currentVesselBox.heading,
          "path",
          pathCounter
        );
        previousVesselBoxes.push(pathBox);
        pathCounter++;
      }
      lastVesselPosition = { lat, lng };
    }
  } else {
    lastVesselPosition = { lat, lng };
  }

  if (currentVesselBox) {
    updateVesselBoxPosition(currentVesselBox, lat, lng, heading);
  } else {
    currentVesselBox = createVesselBox(lat, lng, heading, "current");
  }
}

// Update red path line
function updateRedPathLine() {
  if (pathPoints.length < 2) return;

  if (pathPolyline) {
    pathPolyline.setMap(null);
  }

  pathPolyline = new google.maps.Polyline({
    path: pathPoints,
    strokeColor: "#FF0000",
    strokeOpacity: 0.8,
    strokeWeight: 3,
    map: map,
    clickable: false,
    zIndex: 5,
  });
}

// Safe remover helper
function removeVesselBox(box) {
  if (!box) return;
  try {
    if (box.boat) {
      google.maps.event.clearInstanceListeners(box.boat);
      try {
        box.boat.setPath([]);
      } catch (_) {}
      box.boat.setMap(null);
      box.boat = null;
    }
    if (box.front) {
      google.maps.event.clearInstanceListeners(box.front);
      try {
        box.front.setRadius(0);
      } catch (_) {}
      box.front.setMap(null);
      box.front = null;
    }
    if (box.number) {
      box.number.map = null;
      box.number = null;
    }
  } catch (e) {}
}

// Clear path vessel boxes (previous light green boxes) but keep current vessel
function clearVesselBoxes(opts = {}) {
  const { keepCurrent = true, keepPolyline = false } = opts;

  isClearing = true;
  suppressPathCreation = true;

  const toClear = previousVesselBoxes.slice(0);
  previousVesselBoxes.length = 0;

  for (let i = 0; i < toClear.length; i++) {
    if (toClear[i]?.boat)
      try {
        toClear[i].boat.setVisible(false);
      } catch (e) {}
    if (toClear[i]?.front)
      try {
        toClear[i].front.setVisible(false);
      } catch (e) {}
    removeVesselBox(toClear[i]);
  }

  if (vesselBoxes && vesselBoxes.length) {
    const toClearLegacy = vesselBoxes.slice(0);
    vesselBoxes.length = 0;
    for (let i = 0; i < toClearLegacy.length; i++) {
      try {
        toClearLegacy[i].boat?.setVisible(false);
      } catch (e) {}
      try {
        toClearLegacy[i].front?.setVisible(false);
      } catch (e) {}
      removeVesselBox(toClearLegacy[i]);
    }
  }

  if (!keepCurrent && currentVesselBox) {
    try {
      currentVesselBox.boat?.setVisible(false);
    } catch (e) {}
    try {
      currentVesselBox.front?.setVisible(false);
    } catch (e) {}
    removeVesselBox(currentVesselBox);
    currentVesselBox = null;
  }

  if (!keepPolyline && pathPolyline) {
    try {
      google.maps.event.clearInstanceListeners(pathPolyline);
    } catch (_) {}
    try {
      pathPolyline.setMap(null);
    } catch (_) {}
    pathPolyline = null;
  }

  boatPath.length = 0;
  pathPoints.length = 0;
  pathCounter = 0;
  lastVesselPosition = null;

  if (pathPolyline) {
    try {
      pathPolyline.setMap(null);
    } catch (_) {}
    pathPolyline = null;
  }

  if (map) {
    const z = map.getZoom();
    map.setZoom(z);
  }

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
function updateVesselPosition(
  lat,
  lng,
  heading,
  shouldCenter = false,
  meta = {}
) {
  if (!isMapReady()) return;

  if (typeof meta.speedMs === "number") lastSpeedMs = meta.speedMs;

  const hasRTKHeading = !!meta.hasRTKHeading;
  autoZeroMaybe(heading);
  longStopMaybeClear();
  reverseDetectMaybeRezero(heading, hasRTKHeading);

  // Don't create vessels if we're in the middle of clearing
  if (isClearing) return;

  if (window.isTracking) {
    updateVesselBox(lat, lng, heading);
  } else {
    if (currentVesselBox) {
      updateVesselBoxPosition(currentVesselBox, lat, lng, heading);
    } else {
      currentVesselBox = createVesselBox(lat, lng, heading, "current");
    }
  }

  if (shouldCenter) {
    map.setCenter({ lat, lng });
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
    isStuck: !isInWater && landTime > landThreshold,
  };
}

// Export functions for use in main application
if (typeof module !== "undefined" && module.exports) {
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
    getVesselCreationDistance,
    setHeadingZero,
    clearHeadingZero,
    setLogger, // << allow index to pipe logs here
  };
}
