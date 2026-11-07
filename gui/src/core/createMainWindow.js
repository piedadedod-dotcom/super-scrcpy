const { BrowserWindow } = require('electron');
const path = require('node:path');

function createMainWindow(guiDirectory) {
  const window = new BrowserWindow({
    width: 1060,
    height: 850,
    minWidth: 760,
    minHeight: 650,
    autoHideMenuBar: true,
    backgroundColor: '#0b0f14',
    title: 'Super Scrcpy GUI',
    webPreferences: {
      preload: path.join(guiDirectory, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.loadFile(path.join(guiDirectory, 'index.html')).catch((error) => {
    console.error(`Could not load the Super Scrcpy GUI: ${error.message}`);
  });
  return window;
}

module.exports = { createMainWindow };
