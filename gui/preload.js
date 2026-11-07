const { contextBridge, ipcRenderer, webUtils } = require('electron');
const CHANNELS = require('./src/shared/ipcChannels');
const STREAM_CHANNELS = new Set([
  CHANNELS.ADB_DEVICE_CONNECTED,
  CHANNELS.ADB_DEVICE_DISCONNECTED,
  CHANNELS.DEVICE_STATE_CHANGED,
  CHANNELS.SCRCPY_STDOUT,
  CHANNELS.SCRCPY_STDERR,
  CHANNELS.SCRCPY_ERROR,
  CHANNELS.ADB_TRANSFER_PROGRESS,
  CHANNELS.RECORDING_CHANGED,
  CHANNELS.FPS_UPDATE,
]);

function subscribe(channel, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('O callback precisa ser uma função.');
  }

  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('scrcpy', {
  listDevices: () => ipcRenderer.invoke(CHANNELS.ADB_LIST_DEVICES),
  startDevice: (request) => ipcRenderer.invoke(CHANNELS.START_DEVICE, request),
  stopDevice: (serial) => ipcRenderer.invoke(CHANNELS.STOP_DEVICE, serial),
  removeDevice: (serial) => ipcRenderer.invoke(CHANNELS.REMOVE_DEVICE, serial),
  getDeviceStates: () => ipcRenderer.invoke(CHANNELS.GET_DEVICE_STATES),
  checkPrerequisites: () => ipcRenderer.invoke(CHANNELS.PREREQUISITES),
  pairDevice: (request) => ipcRenderer.invoke(CHANNELS.ADB_PAIR_DEVICE, request),
  connectDevice: (request) =>
    ipcRenderer.invoke(CHANNELS.ADB_CONNECT_DEVICE, request),
  generatePairingQr: (request) =>
    ipcRenderer.invoke(CHANNELS.GENERATE_PAIRING_QR, request),
  uploadDroppedFiles: (serial, files) => {
    const filePaths = Array.from(files, (file) =>
      webUtils.getPathForFile(file));
    return ipcRenderer.invoke(CHANNELS.ADB_UPLOAD_FILES, { serial, filePaths });
  },
  listDownloadFiles: (serial) =>
    ipcRenderer.invoke(CHANNELS.ADB_LIST_DOWNLOAD_FILES, serial),
  pullDownloadFile: (serial, name) =>
    ipcRenderer.invoke(CHANNELS.ADB_PULL_DOWNLOAD_FILE, { serial, name }),
  toggleRecording: (serial) =>
    ipcRenderer.invoke(CHANNELS.TOGGLE_RECORDING, serial),
  getTheme: () => ipcRenderer.invoke(CHANNELS.GET_THEME),
  setTheme: (theme) => ipcRenderer.invoke(CHANNELS.SET_THEME, theme),
  onEvent: (channel, callback) => {
    if (!STREAM_CHANNELS.has(channel)) {
      throw new TypeError('Canal de evento não permitido.');
    }
    return subscribe(channel, callback);
  },
  onDeviceConnected: (callback) =>
    subscribe(CHANNELS.ADB_DEVICE_CONNECTED, callback),
  onDeviceDisconnected: (callback) =>
    subscribe(CHANNELS.ADB_DEVICE_DISCONNECTED, callback),
  onDeviceStateChanged: (callback) =>
    subscribe(CHANNELS.DEVICE_STATE_CHANGED, callback),
  onScrcpyStdout: (callback) => subscribe(CHANNELS.SCRCPY_STDOUT, callback),
  onScrcpyStderr: (callback) => subscribe(CHANNELS.SCRCPY_STDERR, callback),
  onScrcpyError: (callback) => subscribe(CHANNELS.SCRCPY_ERROR, callback),
});
