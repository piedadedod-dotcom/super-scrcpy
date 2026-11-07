const CHANNELS = require('../shared/ipcChannels');
const QRCode = require('qrcode');
const path = require('node:path');
const { isIP } = require('node:net');
const { DEVICE_STATES } = require('../core/DeviceStateMachine');
const { THEMES } = require('../managers/SettingsManager');

function operationError(scrcpyManager, serial, prefix, error) {
  const message = `${prefix}: ${error.message}`;
  const deviceSerial = typeof serial === 'string' && serial.trim()
    ? serial
    : 'adb-operation';
  scrcpyManager.reportDeviceError(deviceSerial, message);
  return { ok: false, state: DEVICE_STATES.ERROR, message };
}

function registerIpcHandlers({
  ipcMain,
  adbManager,
  scrcpyManager,
  getWindows,
  dialog,
  app,
  settingsManager,
}) {
  const send = (channel, payload) => {
    for (const window of getWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, payload);
      }
    }
  };

  adbManager.on('device-connected', (device) => {
    send(CHANNELS.ADB_DEVICE_CONNECTED, device);
  });
  adbManager.on('device-disconnected', (device) => {
    send(CHANNELS.ADB_DEVICE_DISCONNECTED, device);
  });
  scrcpyManager.on('device-state', (state) => {
    send(CHANNELS.DEVICE_STATE_CHANGED, state);
  });
  scrcpyManager.on('scrcpy-stdout', (log) => {
    send(CHANNELS.SCRCPY_STDOUT, log);
  });
  scrcpyManager.on('scrcpy-stderr', (log) => {
    send(CHANNELS.SCRCPY_STDERR, log);
  });
  scrcpyManager.on('scrcpy-error', (error) => {
    send(CHANNELS.SCRCPY_ERROR, error);
  });
  scrcpyManager.on('recording-changed', (recording) => {
    send(CHANNELS.RECORDING_CHANGED, recording);
  });
  scrcpyManager.on('fps-update', (metrics) => {
    send(CHANNELS.FPS_UPDATE, metrics);
  });
  adbManager.on('transfer-progress', (progress) => {
    send(CHANNELS.ADB_TRANSFER_PROGRESS, progress);
  });
  adbManager.on('adb-warning', (warning) => {
    send(CHANNELS.SCRCPY_STDERR, { ...warning, stream: 'stderr' });
  });

  ipcMain.handle(CHANNELS.ADB_LIST_DEVICES, async () => {
    try {
      return { ok: true, ...(await adbManager.listDevices()) };
    } catch (error) {
      send(CHANNELS.SCRCPY_ERROR, {
        message: `Falha ao buscar dispositivos ADB: ${error.message}`,
      });
      return { ok: false, message: error.message, devices: [] };
    }
  });
  ipcMain.handle(CHANNELS.START_DEVICE, (_event, request) =>
    scrcpyManager.startDevice(request || {}));
  ipcMain.handle(CHANNELS.STOP_DEVICE, (_event, serial) =>
    scrcpyManager.stopDevice(serial));
  ipcMain.handle(CHANNELS.REMOVE_DEVICE, (_event, serial) =>
    scrcpyManager.removeDevice(serial));
  ipcMain.handle(CHANNELS.GET_DEVICE_STATES, () =>
    scrcpyManager.getStates());
  ipcMain.handle(CHANNELS.PREREQUISITES, () =>
    scrcpyManager.checkPrerequisites());
  ipcMain.handle(CHANNELS.TOGGLE_RECORDING, async (_event, serial) => {
    try {
      return await scrcpyManager.toggleRecording(serial);
    } catch (error) {
      return operationError(
        scrcpyManager,
        serial,
        'Falha ao alternar gravação',
        error,
      );
    }
  });
  ipcMain.handle(CHANNELS.GET_THEME, () => {
    const theme = settingsManager.getTheme();
    return { theme, color: THEMES[theme] };
  });
  ipcMain.handle(CHANNELS.SET_THEME, (_event, theme) => {
    try {
      const savedTheme = settingsManager.setTheme(theme);
      return { ok: true, theme: savedTheme, color: THEMES[savedTheme] };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });
  ipcMain.handle(CHANNELS.ADB_PAIR_DEVICE, async (_event, request = {}) => {
    const input = request || {};
    const serial = typeof input.host === 'string' && input.host
      ? `${input.host}:${input.connectionPort || input.pairingPort || ''}`
      : 'wireless-pairing';
    try {
      return await adbManager.pairDevice(input);
    } catch (error) {
      return operationError(
        scrcpyManager,
        serial,
        'Falha no pareamento/conexão ADB',
        error,
      );
    }
  });
  ipcMain.handle(CHANNELS.ADB_CONNECT_DEVICE, async (_event, request = {}) => {
    const input = request || {};
    const serial = typeof input.host === 'string' && input.host
      ? `${input.host}:${input.connectionPort || ''}`
      : 'wireless-pairing';
    try {
      return await adbManager.connectDevice(input);
    } catch (error) {
      return operationError(
        scrcpyManager,
        serial,
        'Falha ao conectar o dispositivo via ADB',
        error,
      );
    }
  });
  ipcMain.handle(CHANNELS.ADB_UPLOAD_FILES, async (_event, request = {}) => {
    const input = request || {};
    try {
      return await adbManager.uploadFiles(input.serial, input.filePaths);
    } catch (error) {
      return operationError(
        scrcpyManager,
        input.serial,
        'Falha ao enviar arquivos',
        error,
      );
    }
  });
  ipcMain.handle(CHANNELS.ADB_LIST_DOWNLOAD_FILES, async (_event, serial) => {
    try {
      return { ok: true, files: await adbManager.listDownloadFiles(serial) };
    } catch (error) {
      return operationError(
        scrcpyManager,
        serial,
        'Falha ao listar arquivos do dispositivo',
        error,
      );
    }
  });
  ipcMain.handle(
    CHANNELS.ADB_PULL_DOWNLOAD_FILE,
    async (_event, request = {}) => {
      const { serial, name } = request || {};
      try {
        const result = await dialog.showSaveDialog({
          defaultPath: path.join(app.getPath('downloads'), name),
          title: 'Salvar arquivo do dispositivo',
        });
        if (result.canceled) {
          return { ok: false, canceled: true };
        }
        return await adbManager.pullDownloadFile(serial, name, result.filePath);
      } catch (error) {
        return operationError(
          scrcpyManager,
          serial,
          'Falha ao baixar arquivo',
          error,
        );
      }
    },
  );
  ipcMain.handle(CHANNELS.GENERATE_PAIRING_QR, async (_event, request = {}) => {
    const { host, pairingPort, code, connectionPort } = request || {};
    if (typeof host !== 'string' || !isIP(host.trim())
        || !Number.isInteger(Number(pairingPort))
        || Number(pairingPort) < 1 || Number(pairingPort) > 65535
        || (connectionPort !== undefined && connectionPort !== ''
          && (!Number.isInteger(Number(connectionPort))
            || Number(connectionPort) < 1 || Number(connectionPort) > 65535))
        || !/^\d{6}$/.test(String(code || ''))) {
      return { ok: false, message: 'Informe IP, porta e código válidos para gerar o QR.' };
    }
    const payload = JSON.stringify({
      type: 'scrcpy-adb-pair',
      ip: host.trim(),
      pairingPort: Number(pairingPort),
      connectionPort: connectionPort ? Number(connectionPort) : undefined,
      code: String(code),
    });
    try {
      const dataUrl = await QRCode.toDataURL(payload, {
        width: 240,
        margin: 2,
        color: { dark: '#17211d', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
      return { ok: true, dataUrl };
    } catch (error) {
      return { ok: false, message: `Não foi possível gerar o QR: ${error.message}` };
    }
  });
}

module.exports = { registerIpcHandlers };
