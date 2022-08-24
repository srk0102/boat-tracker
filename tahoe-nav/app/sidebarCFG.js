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
          var path = new google.maps.Polyline({
            path: coords,
            geodesic: true,
            strokeColor: '#FFFFFF',
            strokeOpacity: 1.0,
            strokeWeight: 3
          });
          path.setMap(map);
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
  const marker = new google.maps.Marker({
    position,
    icon: "./assets/pin11green.png",
    label: {
      text: `R`,
      fontSize:"10px",
    },
    map,
  });

}

module.exports = { makeSidebarCFG };