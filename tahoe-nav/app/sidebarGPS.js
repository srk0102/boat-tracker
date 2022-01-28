// Creates Sidebar view for GPS mode
function makeSidebarGPS() {
  settingPath = false;
  settingZoneState = "init";

  var sidebarGPS = document.createElement("div");

  var text = document.createElement("p");
  text.innerHTML = "GPS Mode active";

  var trackingButton = document.createElement("button");
  trackingButton.id = "tracking-button";
  if (isTracking) {
    trackingButton.innerHTML = "Stop Tracking";
    trackingButton.className = "btn btn-negative btn-large btn-sb";
  } else {
    trackingButton.innerHTML = "Start Tracking";
    trackingButton.className = "btn btn-positive btn-large btn-sb";
  }
  trackingButton.addEventListener("click", function () {
    isTracking = !isTracking;
    if (isTracking) {
      this.innerHTML = "Stop Tracking";
      this.className = "btn btn-negative btn-large btn-sb";
      startLog = moment();
      applog.info("Started tracking");
      navlog.info("Started tracking");
    } else {
      this.innerHTML = "Start Tracking";
      this.className = "btn btn-positive btn-large btn-sb";
      applog.info("Stopped tracking");
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
      zone.setMap(null);
      zone = new google.maps.Polyline({
        map: map,
        path: [],
        strokeColor: "#FF0000",
        strokeOpacity: 1.0,
        strokeWeight: 2,
      });
      settingZoneState = "setting";
    } else if (settingZoneState == "setting") {
      setZoneButton.innerHTML = "Select Zone";
      zone.setMap(null);
      zone = new google.maps.Polyline({
        map: map,
        path: [],
        strokeColor: "#FF0000",
        strokeOpacity: 1.0,
        strokeWeight: 2,
      });
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
    path.setPath([]);
    path.setMap(null);
    zone.setPath([]);
    zone.setPath(null);
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
