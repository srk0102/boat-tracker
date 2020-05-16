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

var map; // Map Object
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
    center: { lat: 38.959533, lng: -119.951611 }, // Default coord, loop will update with true coord
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
  })

  vessel = new google.maps.Marker({
    map: map,
    icon: "./assets/vessel.png",
    position: { lat: 38.959533, lng: -119.951611 },
  })

  google.maps.event.addListener(map, "click", function (clickEvent) {
    if (settingPath) {
      path.getPath().push(clickEvent.latLng);
    } else if (settingZoneState == "setting") {
      if (zone.getPath().length === 0) {
        marker = new google.maps.Marker({
          map: map, position: clickEvent.latLng, draggable: false
        })
        google.maps.event.addListener(marker, 'click', function() {
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
          document.getElementById("set-zone-button").innerHTML = "Generate Path";
        })
      }
      zone.getPath().push(clickEvent.latLng);
    }
  });
}

function generatePath() {
  vertices = zone.getPath();
  vArray = []
  for (var i =0; i < vertices.getLength(); i++) {
    var xy = vertices.getAt(i);
    var contentString = '<br>' + 'Coordinate ' + i + ':<br>' + xy.lat() + ',' +
        xy.lng();
    vArray.push({lat: xy.lat(), lng: xy.lng()})
  }
  console.log(vArray)
  path.getPath().push(vertices.getAt(0));
  path.getPath().push(vertices.getAt(1));
  var lastpoint = path.getPath().getAt(path.getPath().getLength()-1)
  var count = 1;
  var heading = google.maps.geometry.spherical.computeHeading(vertices.getAt(0), vertices.getAt(1));
  var headinga = google.maps.geometry.spherical.computeHeading(vertices.getAt(1), vertices.getAt(2));
  var headingb = google.maps.geometry.spherical.computeHeading(vertices.getAt(0), vertices.getAt(vertices.getLength()-1));
  while (google.maps.geometry.poly.containsLocation(lastpoint, zone)) {
    var a = google.maps.geometry.spherical.computeOffset(vertices.getAt(1), count*2, headinga)
    var b = google.maps.geometry.spherical.computeOffset(vertices.getAt(0), count*2, headingb)
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
  document.getElementById("set-zone-button").innerHTML = "Select Zone"
  settingZoneState = "init"
}

var buttonModeMan = document.getElementById("button-mode-man");
var buttonModeGPS = document.getElementById("button-mode-gps");
var buttons = document.getElementsByClassName("disabled");
var boardstatus = document.getElementById("board-status");

var isManual;
var isTracking = false;
var trackedPos = [];
var hasFix = false;
var lastLogged;
var centerOnPos = true;
// Joystick config
const deadZoneRange = 30;
const center = 512;
// Motor driver config
const LFTaddress = 128;
const FR1address = 129;
const FR2address = 130;
const RGTaddress = 131;

const { Board, Led, Pin } = require("johnny-five");
const GPS = require("./gps");

const board = new Board({
  repl: false, // important! enabling repl crashes electron
});

board.on("ready", () => {
  const led = new Led(13);
  var gps = new GPS({
    baud: 9600, // Ideally should be 115200 but looks like serial has issues reading at that rate
    port: 1, // HWSerial1 (port 1) is on rx 19, tx 18, alternatively use this.io.SERIAL_PORT_IDs.HW_SERIAL1
  });

  console.log(gps.io)

  // Pins for joystick input
  var pinX = new Pin("A0");
  var pinY = new Pin("A1");
  var pinZ = new Pin("A2");

  // Pin for packetized serial
  var driverSerial = new Pin(11);

  //gps.on("sentence", sentence => console.log(sentence) );

  boardstatus.innerHTML = "Board connected on " + board.port;

  function loop() {
    setTimeout(() => {
      // LED toggle for debug purposes
      led.toggle();
      var pos = {
        lat: gps.latitude,
        lng: gps.longitude,
      };
      var [intX, intY, intZ] = getJoystickIntent();

      if (hasFix) {
        vessel.setPosition(pos);
      }

      // Logging conditions
      if (hasFix && isTracking && moment() - lastLogged > 2000) {
        navlog.info(pos);
        trackedPos.push(pos)
        trackedPath.setPath(trackedPos);
        lastLogged = moment();
      } else if (!hasFix && pos.lat) {
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

  // Send command to motor driver
  function sendMotorCommand(address, command, value) {
    // WIP
    driverSerial.write(address);
    driverSerial.write(command);
    driverSerial.write(value);
    driverSerial.write((address + command + value) & 0b01111111);
    //console.log(address, command, value, (address + command + value) & 0b01111111)
  }

  // Initializes motor drivers
  function motorDriverSetup() {
    //WIP
  }

  // Reads joystick input and parses intent
  function getJoystickIntent() {
    var xstd;
    var ystd;
    var zstd;
    var xIntent = 0;
    var yIntent = 0;
    var zIntent = 0;
    xstd = pinX.value - center;
    ystd = pinY.value - center;
    zstd = pinZ.value - center;
    if (Math.abs(xstd) > deadZoneRange && Math.abs(zstd) > deadZoneRange) {
      zIntent = (127 * zstd) / center;
    } else if (Math.abs(xstd) > deadZoneRange) {
      xIntent = (127 * xstd) / center;
    } else if (Math.abs(zstd) > deadZoneRange) {
      zIntent = (127 * zstd) / center;
    }
    if (Math.abs(ystd) > deadZoneRange) {
      yIntent = (127 * ystd) / center;
    }
    return [xIntent, yIntent, zIntent];
  }

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
        setZoneButton.innerHTML = "Select Zone"
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
      path.setMap(null)
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

    sidebarMAN.appendChild(text);
    sidebarMAN.appendChild(trackingButton);
    sidebarMAN.appendChild(centerOnPosButton);
    return sidebarMAN;
  }

  // Driver function for setting sidebar
  function setSidebarContents(mode) {
    var p = document.getElementById("sidebar-content");
    while (p.firstChild) {
      p.removeChild(p.lastChild);
    }
    var sidebarContent;
    if (mode == "man") {
      sidebarContent = makeSidebarMAN();
      isManual = true;
    } else {
      sidebarContent = makeSidebarGPS();
      isManual = false;
    }
    p.appendChild(sidebarContent);
  }

  buttonModeMan.addEventListener("click", function () {
    isManual = true;
    setSidebarContents("man");
    buttonModeMan.classList.add("active");
    buttonModeGPS.classList.remove("active");
  });
  buttonModeGPS.addEventListener("click", function () {
    isManual = false;
    setSidebarContents("gps");
    buttonModeMan.classList.remove("active");
    buttonModeGPS.classList.add("active");
  });

  while (buttons.length > 0) {
    buttons[0].classList.remove("disabled");
  }
  applog.info("Board initialized");
  navlog.info("App started, waiting for fix");
  lastLogged = moment();
  loop();
});
