function makeSidebarCFG() {
    var sidebarCFG = document.createElement("div");
  
    // Button to load previous paths from log file and then draw on map
    var loadPathButton = document.createElement("button");
    loadPathButton.className = "btn btn-default btn-large btn-sb";
    loadPathButton.id = "load-path-button";
    loadPathButton.innerHTML = "Load Path from File";
    loadPathButton.addEventListener("click", function () {
      const { dialog } = require("electron").remote
      filepath = dialog.showOpenDialogSync({title: "Open Log File", filters: [{name: "Log Files", extensions: ['log']}]})[0]
      fs.readFile(filepath, 'utf-8', (err, data) => {
        if(err) {
          alert("An error ocurred reading the file :" + err.message);
          return;
        }
        var dataArray = data.toString().split("\n"); // Log lines in array
        var coords = []
        dataArray.forEach(function(item, index) {
          item = item.split("] ")[2] // Regex to isolate content
          if (item != undefined && item[1] == "{") { // Line holds a coordinate
            item = item.split(": ")
            var lat = item[1].split(",")[0] // Isolate lat/lng
            var lng = item[2].split(" ")[0]
            coords.push({lat: parseFloat(lat), lng: parseFloat(lng)});
          }
        })
        console.log(coords)
        if (coords.length > 0) {
          // Convert coordinates to Mapbox format [lng, lat]
          const pathCoordinates = coords.map(coord => [coord.lng, coord.lat]);
          
          // Update the path source with imported coordinates
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
            console.log('Path imported with', pathCoordinates.length, 'points');
          }
        } else {
          console.log("Error: coords holds no coordinates")
        }
      })
    });

    // Button to load reference points (geofence, etc.)
    var loadRefButton = document.createElement("button");
    loadRefButton.className = "btn btn-default btn-large btn-sb";
    loadRefButton.id = "load-ref-button";
    loadRefButton.innerHTML = "Load Reference Points from File";
    loadRefButton.addEventListener("click", function() {
      const { dialog } = require("electron").remote
      filePathRef = dialog.showOpenDialogSync({title: "Open Reference File", filters: [{name: "Log Files", extensions: ['log']}]})[0]
      fs.readFile(filePathRef, 'utf-8', (err, data) => {
        if(err) {
          alert("An error ocurred reading the file :" + err.message);
          return;
        }
        var dataArrayRef = data.toString().split("\n"); // Log lines in array
        var coordsRef = []
        dataArrayRef.forEach(function(item, index) {
          item = item.split("\t"); // Regex to isolate content
          item = item.slice(-2);
          if (item.length == 2) { // Line holds a coordinate
            var lat = item[0]
            var lng = item[1]
            coordsRef.push({lat: parseFloat(lat), lng: parseFloat(lng)});
          }
        })
        markersRef = []
        if (coordsRef.length > 0) {
          coordsRef.forEach(function(item, index) {
            addMarker(item);
          })
        } else {
          console.log("Error: coordsRef holds no coordinates")
        }
      })
    });
  
    sidebarCFG.appendChild(loadPathButton);
    sidebarCFG.appendChild(loadRefButton);
    return sidebarCFG;
}

// Adds a reference marker to the map.
function addMarker(position) {
  // Create custom marker element with green pin and "R" label
  const markerElement = document.createElement('div');
  markerElement.className = 'reference-marker';
  markerElement.innerHTML = `
    <div style="
      background-image: url('./assets/pin11green.png');
      background-size: contain;
      background-repeat: no-repeat;
      width: 30px;
      height: 40px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 10px;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
    ">
      R
    </div>
  `;

  const marker = new mapboxgl.Marker({
    element: markerElement,
    anchor: 'bottom'
  })
  .setLngLat([position.lng, position.lat])
  .addTo(map);
}

module.exports = { makeSidebarCFG };