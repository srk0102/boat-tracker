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

// Set up API for maps
const API_KEY = fs.readFileSync("./key.txt", "utf-8");
if (API_KEY.length < 1) {
  console.log("API key failed to load: check key.txt");
  applog.error("API Key not found");
}
// Inject google maps js
var js_file = document.createElement("script");
js_file.type = "text/javascript";
js_file.src =
  "https://maps.googleapis.com/maps/api/js?callback=initMap&key=" +
  API_KEY +
  "&language=en&libraries=geometry";
document.getElementsByTagName("head")[0].appendChild(js_file);

// Import functions
const { updateDistTable } = require("./sidebarMAN");
const { setSidebarContents } = require("./sidebar");

// Data for gps distance
const haversine = require("haversine");
const convert = require("convert-units");
var disttableheader = ["", "Lat.", "Lon.", 	"\u0394Lat. (ft)", "\u0394Lon. (ft)", "Dist.(ft)"];
var disttabledata = [["Curr. Pos.", "", "", "0", "0", 0]];

var map; // Map Object
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

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 37.953312, lng: -121.307024 }, // Default coord, loop will update with true coord
    zoom: 18,
    mapTypeId: "satellite",
    mapTypeControl: false,
    tilt: 0,
    rotateControl: false,
    streetViewControl: false,
  });

  google.maps.event.addListener(map, "dragstart", function () {
    centerOnPos = false;
  });

  var isClosed = false;
  zone = new google.maps.Polyline({
    map: map,
    path: [],
    strokeColor: "#FF0000",
    strokeOpacity: 1.0,
    strokeWeight: 2,
  });

  path = new google.maps.Polyline({
    map: map,
    path: [],
    strokeColor: "#FFFF00",
    strokeOpacity: 1.0,
    strokeWeight: 2,
  });

  trackedPath = new google.maps.Polyline({
    map: map,
    path: [],
    strokeColor: "#00FF00",
    strokeWeight: 2,
  });

  vessel = new google.maps.Marker({
    map: map,
    icon: "./assets/vessel.png",
    position: { lat: 38.959533, lng: -119.951611 },
  });

  google.maps.event.addListener(map, "click", function (clickEvent) {
    if (settingPath) {
      path.getPath().push(clickEvent.latLng);
    } else if (settingZoneState == "setting") {
      if (zone.getPath().length === 0) {
        marker = new google.maps.Marker({
          map: map,
          position: clickEvent.latLng,
          draggable: false,
        });
        google.maps.event.addListener(marker, "click", function () {
          if (isClosed) {
            return;
          }
          zonePath = zone.getPath();
          zone.setMap(null);
          zone = new google.maps.Polygon({
            map: map,
            path: zonePath,
            strokeColor: "#FF0000",
            strokeOpacity: 0.3,
            strokeWeight: 2,
            fillColor: "#FF0000",
            fillOpacity: 0.2,
          });
          marker.setMap(null);
          isClosed = true;
          zoneSelected = true;
          settingZoneState = "ready";
          document.getElementById("set-zone-button").innerHTML =
            "Generate Path";
        });
      }
      zone.getPath().push(clickEvent.latLng);
    }
  });
}

function generatePath() {
  vertices = zone.getPath();
  vArray = [];
  for (var i = 0; i < vertices.getLength(); i++) {
    var xy = vertices.getAt(i);
    var contentString =
      "<br>" + "Coordinate " + i + ":<br>" + xy.lat() + "," + xy.lng();
    vArray.push({ lat: xy.lat(), lng: xy.lng() });
  }
  console.log(vArray);
  path.getPath().push(vertices.getAt(0));
  path.getPath().push(vertices.getAt(1));
  var lastpoint = path.getPath().getAt(path.getPath().getLength() - 1);
  var count = 1;
  var heading = google.maps.geometry.spherical.computeHeading(
    vertices.getAt(0),
    vertices.getAt(1)
  );
  var headinga = google.maps.geometry.spherical.computeHeading(
    vertices.getAt(1),
    vertices.getAt(2)
  );
  var headingb = google.maps.geometry.spherical.computeHeading(
    vertices.getAt(0),
    vertices.getAt(vertices.getLength() - 1)
  );
  while (google.maps.geometry.poly.containsLocation(lastpoint, zone)) {
    var a = google.maps.geometry.spherical.computeOffset(
      vertices.getAt(1),
      count * 2,
      headinga
    );
    var b = google.maps.geometry.spherical.computeOffset(
      vertices.getAt(0),
      count * 2,
      headingb
    );
    if (count % 2 == 1) {
      path.getPath().push(a);
      path.getPath().push(b);
      lastpoint = b;
    } else {
      path.getPath().push(b);
      path.getPath().push(a);
      lastpoint = a;
    }
    count += 1;
  }
  document.getElementById("set-zone-button").innerHTML = "Select Zone";
  settingZoneState = "init";
}

var buttonModeMan = document.getElementById("button-mode-man");
var buttonModeGPS = document.getElementById("button-mode-gps");
var buttonModeCfg = document.getElementById("button-mode-cfg");
var buttons = document.getElementsByClassName("disabled");
var boardstatus = document.getElementById("board-status");
var clock = document.getElementById("clock");
var trackingstatus = document.getElementById("tracking-status");

var isManual;
var pos;
var isTracking = false;
var trackedPos = [];
var hasFix = false;
var lastLogged;
var startLog;
var centerOnPos = true;

// const GPS = require("./gps"); old gps
var file = "COM12";
const SerialPort = require("serialport");
const parsers = SerialPort.parsers;
const parser = new parsers.Readline({
  delimiter: "\r\n",
});
const port = new SerialPort(file, {
  baudRate: 9600,
});
port.pipe(parser);
var GPS = require("gps");
var gps = new GPS();
gps.on("data", function (data) {
  //console.log(gps.state);
});
parser.on("data", function (data) {
  gps.update(data);
});

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

    pos = {
      lat: gps.state.lat,
      lng: gps.state.lon,
    };

    // GPS Fix
    if (hasFix) {
      vessel.setPosition(pos);
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
      trackedPath.setPath(trackedPos);
      lastLogged = moment();
    } else if (!hasFix && pos.lat) {
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
loop();
