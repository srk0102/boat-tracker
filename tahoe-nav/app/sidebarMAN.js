// Creates Sidebar view for Manual mode
function makeSidebarMAN() {
  var sidebarMAN = document.createElement("div");

  var text = document.createElement("p");
  text.innerHTML = "Manual Mode active";

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

  var centerOnPosButton = document.createElement("button");
  centerOnPosButton.className = "btn btn-default btn-large btn-sb";
  centerOnPosButton.id = "center-on-pos-button";
  centerOnPosButton.innerHTML = "Center on Pos";
  centerOnPosButton.addEventListener("click", function () {
    centerOnPos = true;
  });

  var hr = document.createElement("hr");

  // Set current pos for gps distance table
  disttabledata[0][1] = pos.lat;
  disttabledata[0][2] = pos.lng;
  var coordtable = makeDistTable();
  var coordtableContainer = document.createElement("div");
  coordtableContainer.id = "coord-table-container";
  coordtableContainer.appendChild(coordtable);

  // Create buttons to control table
  var gpsDistanceControls = document.createElement("div");
  gpsDistanceControls.className = "btn-group";
  gpsDistanceControls.id = "gps-distance-controls";
  var addPointButton = document.createElement("button");
  addPointButton.className = "btn btn-default btn-large";
  addPointButton.id = "add-point-button";
  addPointButton.innerHTML = "Add Point";
  addPointButton.addEventListener("click", function () {
    var len = disttabledata.length;
    disttabledata.push(["Point " + len, pos.lat, pos.lng, "-", "-", "-"]);
    var position = { lat: pos.lat, lng: pos.lng };
    addMarker(position);
    updateDistTable();
    navlog.info(`Ref Pt Marked: { lat: ${pos.lat}, lng: ${pos.lng} }`);
  });
  var clearPointsButton = document.createElement("button");
  clearPointsButton.className = "btn btn-default btn-large";
  clearPointsButton.id = "clear-points-button";
  clearPointsButton.innerHTML = "Clear Points";
  clearPointsButton.addEventListener("click", function () {
    disttabledata.length = 1; // Removes all but curr pos row
    deleteMarkers();
    updateDistTable();
    navlog.info("Ref Pts Cleared")
  });
  gpsDistanceControls.appendChild(addPointButton);
  gpsDistanceControls.appendChild(clearPointsButton);

  sidebarMAN.appendChild(text);
  sidebarMAN.appendChild(trackingButton);
  sidebarMAN.appendChild(centerOnPosButton);
  sidebarMAN.appendChild(hr);
  sidebarMAN.appendChild(coordtableContainer);
  sidebarMAN.appendChild(gpsDistanceControls);
  return sidebarMAN;
}

function makeDistTable() {
  // Makes distance table for distance tracking feature
  var coordtable = document.createElement("table");
  coordtable.id = "coord-table";
  coordtable.style.border = "1px solid #000";

  // Make header
  var header = coordtable.createTHead();
  var r = header.insertRow(-1);
  for (i = 0; i < disttableheader.length; i++) {
    var c = r.insertCell(i);
    c.innerHTML = disttableheader[i];
  }

  var body = coordtable.createTBody();
  for (i = 0; i < disttabledata.length; i++) {
    r = body.insertRow(-1);
    for (j = 0; j < disttabledata[i].length; j++) {
      c = r.insertCell(-1);
      c.innerHTML =
        typeof disttabledata[i][j] == "number"
          ? disttabledata[i][j].toFixed(5)
          : disttabledata[i][j];
    }
  }
  return coordtable;
}

function updateDistData() {
  disttabledata[0][1] = pos.lat;
  disttabledata[0][2] = pos.lng;

  // If points are saved, calculate distance to points
  if (disttabledata.length > 1) {
    for (i = 1; i < disttabledata.length; i++) {
      var currcoord = {
        latitude: disttabledata[0][1],
        longitude: disttabledata[0][2],
      };
      var pointcoord = {
        latitude: disttabledata[i][1],
        longitude: disttabledata[i][2],
      };

      // lat/lng dist isolated by using currcoord as baseline
      var distlatmeters = haversine(
        [currcoord.latitude, currcoord.longitude],
        [pointcoord.latitude, currcoord.longitude],
        { format: "[lat,lon]" }
      ); // Calculate N/S distance
      distlatmeters =
        currcoord.latitude > pointcoord.latitude
          ? distlatmeters
          : 0 - distlatmeters; // Determine direction
      disttabledata[i][3] = convert(distlatmeters).from("m").to("ft");

      var distlngmeters = haversine(
        [currcoord.latitude, currcoord.longitude],
        [currcoord.latitude, pointcoord.longitude],
        { format: "[lat,lon]" }
      );
      distlngmeters =
        currcoord.longitude > pointcoord.longitude
          ? distlngmeters
          : 0 - distlngmeters;
      disttabledata[i][4] = convert(distlngmeters).from("m").to("ft");

      var distmeters = haversine(currcoord, pointcoord, { unit: "meter" });
      disttabledata[i][5] = convert(distmeters).from("m").to("ft");
    }
  }
}

function updateDistTable() {
  // Refreshes display table
  // Update data
  updateDistData();

  // Remove existing table
  var coordtableContainer = document.getElementById("coord-table-container");
  while (coordtableContainer.firstChild) {
    coordtableContainer.removeChild(coordtableContainer.lastChild);
  }

  // Make new table
  var coordtable = makeDistTable(disttabledata);

  coordtableContainer.appendChild(coordtable);
}

// Adds a marker to the map and push to the array.
function addMarker(position) {
  const marker = new google.maps.Marker({
    position,
    label: `${markers.length + 1}`,
    map,
  });

  markers.push(marker);
}

// Sets the map on all markers in the array.
function setMapOnAll(map) {
  for (let i = 0; i < markers.length; i++) {
    markers[i].setMap(map);
  }
}

// Removes the markers from the map, but keeps them in the array.
function hideMarkers() {
  setMapOnAll(null);
}

// Shows any markers currently in the array.
function showMarkers() {
  setMapOnAll(map);
}

// Deletes all markers in the array by removing references to them.
function deleteMarkers() {
  hideMarkers();
  markers = [];
}

module.exports = {
  makeSidebarMAN,
  makeDistTable,
  updateDistData,
  updateDistTable,
};
