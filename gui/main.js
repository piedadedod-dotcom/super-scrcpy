const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage,
  Notification,
} = require('electron');
const path = require('node:path');
const { createMainWindow } = require('./src/core/createMainWindow');
const { AdbManager } = require('./src/managers/AdbManager');
const { ScrcpyManager } = require('./src/managers/ScrcpyManager');
const { SettingsManager } = require('./src/managers/SettingsManager');
const { registerIpcHandlers } = require('./src/ipc/registerIpcHandlers');

const guiDirectory = __dirname;
const resourcesDirectory = app.isPackaged
  ? process.resourcesPath
  : path.resolve(guiDirectory, '..');
const adbDirectory = app.isPackaged
  ? path.join(resourcesDirectory, 'platform-tools')
  : process.env.SCRCPY_ADB_DIRECTORY
    || path.resolve(guiDirectory, '..', '..', '..', '..', 'ucrt64', 'bin');
const adbExecutable = path.join(adbDirectory, 'adb.exe');
const runtimeEnv = {
  ...process.env,
  PATH: `${adbDirectory}${path.delimiter}${process.env.PATH || ''}`,
};
const scrcpyManager = ScrcpyManager.getInstance({
  scrcpyExecutable: path.join(resourcesDirectory, 'x', 'app', 'scrcpy.exe'),
  adbExecutable,
  cwd: resourcesDirectory,
  serverPath: 'scrcpy-server-v5.0.1',
  serverFile: path.join(resourcesDirectory, 'scrcpy-server-v5.0.1'),
  pathPrefix: `${adbDirectory}${path.delimiter}`,
  recordingDirectory: path.join(app.getPath('videos'), 'Super Scrcpy'),
});
const adbManager = new AdbManager({
  adbExecutable,
  env: runtimeEnv,
});

let mainWindow;
let tray;
let isQuitting = false;
let quitPending = false;

function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow(guiDirectory);
    mainWindow.on('closed', () => {
      mainWindow = undefined;
    });
    mainWindow.on('close', (event) => {
      if (isQuitting) {
        return;
      }
      event.preventDefault();
      mainWindow.hide();
      notify('Super Scrcpy', 'O app continua ativo na bandeja do sistema.');
    });
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

async function startFirstDeviceFromTray() {
  try {
    let session = scrcpyManager.getStates().find((device) =>
      !device.canStop
      && ['IDLE', 'ERROR'].includes(device.state)
      && ['device', undefined].includes(device.device?.state));
    if (!session) {
      const { devices } = await adbManager.listDevices();
      const device = devices.find((candidate) => candidate.state === 'device');
      if (device) {
        scrcpyManager.getSession(device.serial, device);
        session = scrcpyManager.getStates().find((item) =>
          item.serial === device.serial);
      }
    }

    if (!session) {
      notify('Super Scrcpy', 'Nenhum dispositivo ADB pronto foi encontrado.');
      return;
    }
    const result = scrcpyManager.startDevice({
      serial: session.serial,
      device: session.device,
      profile: session.profile || 'default',
    });
    if (result.ok) {
      notify('Super Scrcpy', `Iniciando scrcpy em ${session.device?.model || session.serial}.`);
    } else {
      notify('Falha ao iniciar scrcpy', result.message);
    }
  } catch (error) {
    notify('Falha ao iniciar scrcpy', error.message);
  }
}

function createTray() {
  const image = nativeImage.createFromPath(
    path.join(
      app.isPackaged ? resourcesDirectory : guiDirectory,
      'assets',
      'super-scrcpy-tray.png',
    ),
  ).resize({ width: 16, height: 16 });
  if (image.isEmpty()) {
    throw new Error('O ícone PNG da bandeja não pôde ser carregado.');
  }
  tray = new Tray(image);
  tray.setToolTip('Super Scrcpy — execução em segundo plano');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Super Scrcpy', click: showMainWindow },
    {
      label: 'Iniciar Scrcpy (Dispositivo 1)',
      click: startFirstDeviceFromTray,
    },
    {
      label: 'Parar Tudo',
      click: async () => {
        const results = await scrcpyManager.stopAll();
        const failed = results.find((result) => !result.ok);
        notify(
          failed ? 'Falha ao parar scrcpy' : 'Super Scrcpy',
          failed?.message || 'Todas as sessões foram encerradas.',
        );
      },
    },
    { type: 'separator' },
    { label: 'Sair', click: quitApp },
  ]));
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

async function quitApp() {
  if (quitPending) {
    return;
  }
  quitPending = true;
  try {
    const results = await scrcpyManager.stopAll();
    const failed = results.find((result) => !result.ok);
    if (scrcpyManager.processes.size) {
      quitPending = false;
      showMainWindow();
      notify(
        'Não foi possível sair',
        failed?.message || 'Uma ou mais sessões continuam ativas.',
      );
      return;
    }
    isQuitting = true;
    tray?.destroy();
    tray = undefined;
    app.quit();
  } catch (error) {
    quitPending = false;
    showMainWindow();
    notify('Falha ao encerrar Super Scrcpy', error.message);
  }
}

app.whenReady().then(async () => {
  try {
    const settingsManager = await SettingsManager.create({ name: 'settings' });
    registerIpcHandlers({
      ipcMain,
      adbManager,
      scrcpyManager,
      settingsManager,
      getWindows: () => BrowserWindow.getAllWindows(),
      dialog,
      app,
    });
    app.setAppUserModelId('com.super-scrcpy.gui');
    createTray();
    showMainWindow();

    app.on('activate', () => {
      showMainWindow();
    });
  } catch (error) {
    console.error(`Could not initialize Super Scrcpy: ${error.stack || error}`);
    dialog.showErrorBox(
      'Falha ao iniciar Super Scrcpy',
      `Não foi possível carregar as configurações do app: ${error.message}`,
    );
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (isQuitting || !scrcpyManager.processes.size) {
    isQuitting = true;
    return;
  }
  event.preventDefault();
  if (!quitPending) {
    quitApp();
  }
});

app.on('window-all-closed', () => {
  // The tray owns the application lifetime.
});
