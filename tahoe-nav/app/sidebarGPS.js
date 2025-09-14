// Creates Sidebar view for GPS mode
function makeSidebarGPS() {
  settingPath = false;
  settingZoneState = "init";

  var sidebarGPS = document.createElement("div");

  var text = document.createElement("p");
  text.innerHTML = "GPS Mode active";

  var trackingButton = document.createElement("button");
  trackingButton.id = "tracking-button";
  // Check global tracking state
  const currentTrackingState = window.isTracking || false;
  if (currentTrackingState) {
    trackingButton.innerHTML = "Stop Tracking";
    trackingButton.className = "btn btn-negative btn-large btn-sb";
  } else {
    trackingButton.innerHTML = "Start Tracking";
    trackingButton.className = "btn btn-positive btn-large btn-sb";
  }
  trackingButton.addEventListener("click", function () {
    // Toggle global tracking state
    window.isTracking = !window.isTracking;
    isTracking = window.isTracking; // Update local variable
    
    if (window.isTracking) {
      // Resume path creation when starting tracking
      if (typeof window.resumePathCreation === 'function') {
        window.resumePathCreation();
      }
      this.innerHTML = "Stop Tracking";
      this.className = "btn btn-negative btn-large btn-sb";
      // Start creating previous vessel boxes (light green)
      startLog = moment();
      applog.info("Started tracking - will create previous vessel boxes");
      navlog.info("Started tracking");
    } else {
      this.innerHTML = "Start Tracking";
      this.className = "btn btn-positive btn-large btn-sb";
      // Stop creating previous vessel boxes
      applog.info("Stopped tracking - no new previous boxes");
      navlog.info("Stopped tracking");
    }
  });

  var setZoneButton = document.createElement("button");
  setZoneButton.className = "btn btn-default btn-large btn-sb";
  setZoneButton.id = "set-zone-button";
  setZoneButton.innerHTML = "Select Zone";
  setZoneButton.addEventListener("click", function () {
    if (settingZoneState == "init") {
      setZoneButton.innerHTML = "Cancel";
      // Clear existing zone (Google Maps version)
      if (window.zone) {
        window.zone.setMap(null);
        window.zone = null;
      }
      settingZoneState = "setting";
    } else if (settingZoneState == "setting") {
      setZoneButton.innerHTML = "Select Zone";
      // Clear existing zone (Google Maps version)
      if (window.zone) {
        window.zone.setMap(null);
        window.zone = null;
      }
      settingZoneState = "init";
    } else if (settingZoneState == "ready") {
      generatePath();
    }
  });

  var createPathButton = document.createElement("button");
  createPathButton.className = "btn btn-default btn-large btn-sb";
  createPathButton.id = "create-path-button";
  createPathButton.innerHTML = "Create Path";
  createPathButton.addEventListener("click", function () {
    settingPath = !settingPath;
    if (settingPath) {
      this.innerHTML = "End Path";
    } else {
      this.innerHTML = "Create Path";
      applog.info("Path manually created");
    }
  });

  var clearButton = document.createElement("button");
  clearButton.className = "btn btn-default btn-large btn-sb";
  clearButton.id = "clear-button";
  clearButton.innerHTML = "Clear Zones/Paths";
  clearButton.addEventListener("click", function () {
    // ❌ Do NOT stop tracking - keep live boat updating
    // window.isTracking = false;

    // ✅ Suppress future trail boxes, but keep live boat updating
    window.suppressPathCreation = true;

    // ✅ Clear existing trail, keep the current boat
    if (typeof window.clearVesselBoxes === 'function') {
      window.clearVesselBoxes({ keepCurrent: true, keepPolyline: false });
    }
    
    // Optional: clear zones/paths/markers like you already do
    if (window.zone) { 
      window.zone.setMap(null); 
      window.zone = null; 
    }
    if (window.path) { 
      window.path.setMap(null); 
      window.path = null; 
    }
    if (typeof window.deleteMarkers === 'function') { 
      window.deleteMarkers(); 
    }
    if (typeof window.disttabledata !== 'undefined') { 
      window.disttabledata.length = 1; 
    }
    if (typeof window.updateDistTable === 'function') { 
      window.updateDistTable(); 
    }
  });

  var startPathButton = document.createElement("button");
  startPathButton.className = "btn btn-default btn-large btn-sb disabled";
  startPathButton.id = "start-path-button";
  startPathButton.innerHTML = "Start Path";

  var centerOnPosButton = document.createElement("button");
  centerOnPosButton.className = "btn btn-default btn-large btn-sb";
  centerOnPosButton.id = "center-on-pos-button";
  centerOnPosButton.innerHTML = "Center on Pos";
  centerOnPosButton.addEventListener("click", function () {
    centerOnPos = true;
  });

  sidebarGPS.appendChild(text);
  sidebarGPS.appendChild(trackingButton);
  sidebarGPS.appendChild(setZoneButton);
  sidebarGPS.appendChild(createPathButton);
  sidebarGPS.appendChild(clearButton);
  sidebarGPS.appendChild(startPathButton);
  sidebarGPS.appendChild(centerOnPosButton);
  return sidebarGPS;
}

module.exports = { makeSidebarGPS };
