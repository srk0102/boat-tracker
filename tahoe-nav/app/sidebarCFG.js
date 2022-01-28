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
  
    sidebarCFG.appendChild(loadPathButton);
    return sidebarCFG;
  }

module.exports = { makeSidebarCFG };