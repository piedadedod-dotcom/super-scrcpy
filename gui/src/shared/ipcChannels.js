(function exposeIpcChannels(root) {
  const channels = Object.freeze({
    ADB_LIST_DEVICES: 'adb:list-devices',
    ADB_PAIR_DEVICE: 'adb:pair-device',
    ADB_CONNECT_DEVICE: 'adb:connect-device',
    ADB_UPLOAD_FILES: 'adb:upload-files',
    ADB_TRANSFER_PROGRESS: 'adb:transfer-progress',
    ADB_LIST_DOWNLOAD_FILES: 'adb:list-download-files',
    ADB_PULL_DOWNLOAD_FILE: 'adb:pull-download-file',
    GENERATE_PAIRING_QR: 'app:generate-pairing-qr',
    TOGGLE_RECORDING: 'device:toggle-recording',
    RECORDING_CHANGED: 'device:recording-changed',
    FPS_UPDATE: 'device:fps-update',
    GET_THEME: 'settings:get-theme',
    SET_THEME: 'settings:set-theme',
    ADB_DEVICE_CONNECTED: 'adb:device-connected',
    ADB_DEVICE_DISCONNECTED: 'adb:device-disconnected',
    START_DEVICE: 'device:start',
    STOP_DEVICE: 'device:stop',
    REMOVE_DEVICE: 'device:remove',
    GET_DEVICE_STATES: 'device:get-states',
    DEVICE_STATE_CHANGED: 'device:state-changed',
    SCRCPY_STDOUT: 'scrcpy:stdout',
    SCRCPY_STDERR: 'scrcpy:stderr',
    SCRCPY_ERROR: 'scrcpy:error',
    PREREQUISITES: 'app:check-prerequisites',
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = channels;
  }
  root.SCRCPY_IPC_CHANNELS = channels;
})(globalThis);
