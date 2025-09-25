const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require('fs');
const path = require('path');

let mainWindow = null;
let setupWindow = null;

function createMainWindow() {
  // Create the main browser window.
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });

  // Load the main application
  mainWindow.loadFile("app/two-point-test.html");

  // Open the DevTools.
  mainWindow.webContents.openDevTools();

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createSetupWindow() {
  // Create the port configuration window.
  setupWindow = new BrowserWindow({
    width: 700,
    height: 800,
    resizable: false,
    center: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Load the port configuration
  setupWindow.loadFile("app/port-config.html");

  // Handle window closed
  setupWindow.on('closed', () => {
    setupWindow = null;
  });
}

function checkConfigExists() {
  const configPath = path.join(__dirname, 'config.json');
  return fs.existsSync(configPath);
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  // Always launch main app - configuration is handled via modal
  createMainWindow();
});

// Quit when all windows are closed.
app.on("window-all-closed", () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});


// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
