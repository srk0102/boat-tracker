const { makeSidebarCFG } = require("./sidebarCFG");
const { makeSidebarGPS } = require("./sidebarGPS");
const { makeSidebarMAN } = require("./sidebarMAN");

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
  } else if (mode == "gps") {
    sidebarContent = makeSidebarGPS();
    isManual = false;
  } else {
    sidebarContent = makeSidebarCFG();
  }
  p.appendChild(sidebarContent);
}

module.exports = { setSidebarContents };
