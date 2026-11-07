const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { DEVICE_STATES, DeviceStateMachine } =
  require('../src/core/DeviceStateMachine');
const {
  AdbManager,
  parseDeviceList,
  parseDownloadListing,
  parseTransferProgress,
} = require('../src/managers/AdbManager');
const { PROFILES, ScrcpyManager, parseFpsOutput } =
  require('../src/managers/ScrcpyManager');
const { SettingsManager, THEMES } =
  require('../src/managers/SettingsManager');
const CHANNELS = require('../src/shared/ipcChannels');
const { registerIpcHandlers } =
  require('../src/ipc/registerIpcHandlers');

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = undefined;
    this.exitCode = null;
    this.signalCode = null;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
  }

  kill() {
    setImmediate(() => {
      this.exitCode = 0;
      this.emit('close', 0, null);
    });
    return true;
  }
}

function createManager(options = {}) {
  let spawnArgs;
  let spawnOptions;
  const child = new FakeChild();
  const manager = new ScrcpyManager({
    scrcpyExecutable: 'C:\\scrcpy.exe',
    adbExecutable: 'C:\\adb.exe',
    cwd: 'C:\\scrcpy',
    serverPath: 'scrcpy-server-v5.0.1',
    serverFile: 'C:\\scrcpy\\scrcpy-server-v5.0.1',
    pathPrefix: 'C:\\msys\\ucrt64\\bin;',
    env: { PATH: 'C:\\Windows\\System32' },
    existsSync: () => true,
    spawnProcess: (_executable, args, options) => {
      spawnArgs = args;
      spawnOptions = options;
      setImmediate(() => {
        child.pid = 42;
        child.emit('spawn');
      });
      return child;
    },
    ...options,
  });
  return {
    manager,
    child,
    get spawnArgs() { return spawnArgs; },
    get spawnOptions() { return spawnOptions; },
  };
}

test('device state machine rejects invalid transitions', () => {
  const machine = new DeviceStateMachine('device-1');
  assert.equal(machine.state, DEVICE_STATES.IDLE);
  assert.equal(machine.transition(DEVICE_STATES.RUNNING), false);
  assert.equal(machine.transition(DEVICE_STATES.STARTING), true);
  assert.equal(machine.transition(DEVICE_STATES.RUNNING), true);
  assert.equal(machine.transition(DEVICE_STATES.IDLE), true);
  assert.equal(machine.transition(DEVICE_STATES.ERROR), true);
});

test('ADB device parser keeps serials, states and model labels', () => {
  const devices = parseDeviceList([
    'List of devices attached',
    'emulator-5554 device product:sdk_gphone64_x86_64 model:Pixel_8 transport_id:1',
    'usb-1 unauthorized usb:1-1',
  ].join('\n'));

  assert.deepEqual(devices.map(({ serial, state }) => [serial, state]), [
    ['emulator-5554', 'device'],
    ['usb-1', 'unauthorized'],
  ]);
  assert.equal(devices[0].model, 'Pixel 8');
});

test('profiles inject the expected arguments and MSYS2 environment', async () => {
  const fixture = createManager();
  const result = fixture.manager.startDevice({
    serial: 'device-1',
    profile: 'gamer',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(fixture.spawnArgs, [
    '-s',
    'device-1',
    '--print-fps',
    '--max-fps',
    '60',
    '--no-audio',
  ]);
  assert.equal(fixture.spawnOptions.cwd, 'C:\\scrcpy');
  assert.equal(fixture.spawnOptions.env.ADB, 'C:\\adb.exe');
  assert.equal(
    fixture.spawnOptions.env.SCRCPY_SERVER_PATH,
    'scrcpy-server-v5.0.1',
  );
  assert.equal(
    fixture.spawnOptions.env.PATH,
    'C:\\msys\\ucrt64\\bin;C:\\Windows\\System32',
  );
  assert.deepEqual(PROFILES.economy.args, ['--max-size', '1024']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.manager.getStates()[0].state, DEVICE_STATES.RUNNING);
});

test('FPS parser extracts valid frame-rate samples', () => {
  assert.deepEqual(
    parseFpsOutput('INFO: 60 fps\nINFO: 59.5 fps\nno metric\n1200 fps'),
    [60, 59.5],
  );
});

test('theme preferences persist only supported palette choices', () => {
  const values = new Map();
  const store = {
    get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    set: (key, value) => values.set(key, value),
  };
  const settings = new SettingsManager(store);

  assert.equal(settings.getTheme(), 'green');
  assert.equal(settings.setTheme('orange'), 'orange');
  assert.equal(settings.getTheme(), 'orange');
  assert.equal(THEMES.orange, '#ffae62');
  assert.throws(() => settings.setTheme('invalid'), /Tema selecionado inválido/);
});

test('recording toggle starts and stops a native mp4 capture', async () => {
  const fixture = createManager();
  fixture.manager.getSession('device-1', { model: 'Pixel' });

  const started = await fixture.manager.toggleRecording('device-1');
  assert.equal(started.ok, true);
  assert.equal(started.isRecording, true);
  assert.match(started.path, /gravacao_.*\.mp4$/);
  assert.ok(fixture.spawnArgs.includes(`--record=${started.path}`));
  await new Promise((resolve) => setImmediate(resolve));

  const stopped = await fixture.manager.toggleRecording('device-1');
  assert.equal(stopped.ok, true);
  assert.equal(stopped.isRecording, false);
  assert.equal(stopped.path, started.path);
  assert.equal(fixture.manager.processes.size, 0);
});

test('recording setup failures are reported without spawning scrcpy', () => {
  const fixture = createManager({
    mkdirSync: () => {
      throw new Error('access denied');
    },
  });
  fixture.manager.getSession('device-1');

  const result = fixture.manager.startDevice({
    serial: 'device-1',
    isRecording: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, DEVICE_STATES.ERROR);
  assert.match(result.message, /access denied/);
  assert.equal(fixture.manager.processes.size, 0);
  assert.equal(fixture.manager.getStates()[0].state, DEVICE_STATES.ERROR);
});

test('duplicate sessions are rejected and stop waits for process close', async () => {
  const fixture = createManager();
  fixture.manager.startDevice({ serial: 'device-1' });
  const duplicate = fixture.manager.startDevice({ serial: 'device-1' });
  assert.equal(duplicate.ok, false);
  assert.equal(fixture.manager.processes.size, 1);
  await new Promise((resolve) => setImmediate(resolve));

  const stopped = await fixture.manager.stopDevice('device-1');
  assert.equal(stopped.ok, true);
  assert.equal(stopped.state, DEVICE_STATES.IDLE);
  assert.equal(fixture.manager.processes.size, 0);
});

test('failed kill keeps process tracked and allows another stop attempt', async () => {
  const fixture = createManager();
  fixture.manager.startDevice({ serial: 'device-1' });
  await new Promise((resolve) => setImmediate(resolve));
  fixture.child.kill = () => false;

  const failedStop = await fixture.manager.stopDevice('device-1');
  assert.equal(failedStop.ok, false);
  assert.equal(failedStop.state, DEVICE_STATES.ERROR);
  assert.equal(fixture.manager.processes.size, 1);
  assert.equal(fixture.manager.getStates()[0].canStop, true);

  fixture.child.kill = () => {
    setImmediate(() => {
      fixture.child.exitCode = 0;
      fixture.child.emit('close', 0, null);
    });
    return true;
  };
  const retry = await fixture.manager.stopDevice('device-1');
  assert.equal(retry.ok, true);
  assert.equal(retry.state, DEVICE_STATES.IDLE);
  assert.equal(fixture.manager.processes.size, 0);
});

test('ADB operation failures put the device state machine in ERROR', () => {
  const fixture = createManager();
  assert.equal(
    fixture.manager.reportDeviceError('device-2', 'ADB disconnected.'),
    true,
  );
  assert.equal(fixture.manager.getStates()[0].state, DEVICE_STATES.ERROR);
  assert.equal(fixture.manager.getStates()[0].canStop, false);

  const connected = fixture.manager.getSession('device-live', {
    serial: 'device-live',
    state: 'device',
  });
  fixture.manager.reportDeviceError('device-live', 'Temporary ADB failure.');
  assert.equal(connected.device.state, 'device');
});

function createAdbManager(responses) {
  const calls = [];
  const manager = new AdbManager({
    adbExecutable: 'C:\\adb.exe',
    timeoutMs: 1000,
    stat: async () => ({ isFile: () => true }),
    spawnProcess: (_executable, args) => {
      calls.push(args);
      const child = new FakeChild();
      const response = responses.shift() || { stdout: '', stderr: '', code: 0 };
      setImmediate(() => {
        if (response.stdoutChunks) {
          for (const chunk of response.stdoutChunks) {
            child.stdout.write(chunk);
          }
        } else if (response.stdout) {
          child.stdout.write(response.stdout);
        }
        if (response.stderr) {
          child.stderr.write(response.stderr);
        }
        child.emit('close', response.code ?? 0, null);
      });
      return child;
    },
  });
  return { manager, calls };
}

test('ADB transfer and Download listing parsers handle progress and filenames', () => {
  assert.deepEqual(parseTransferProgress(
    'file: [  7%] file: [ 85%] done [100%]',
  ), [7, 85, 100]);
  assert.deepEqual(parseDownloadListing([
    'total 16',
    '-rw-rw---- 1 u0_a123 media_rw 2048 2026-11-06 09:14 vacation video.mp4',
    '-rw-rw---- 1 u0_a123 media_rw 12 2026-11-06 09:15 .',
    'drwxrwx--- 2 u0_a123 media_rw 4096 2026-11-06 09:15 folder',
  ].join('\n')), [{
    name: 'vacation video.mp4',
    size: 2048,
    date: '2026-11-06 09:14',
  }]);
});

test('wireless pairing connects and returns the ADB device', async () => {
  const fixture = createAdbManager([
    { stdout: 'Successfully paired to 192.168.1.25:37123', code: 0 },
    { stdout: 'connected to 192.168.1.25:5555', code: 0 },
    {
      stdout: 'List of devices attached\n192.168.1.25:5555 device model:Pixel_9\n',
      code: 0,
    },
  ]);
  const result = await fixture.manager.pairDevice({
    host: '192.168.1.25',
    pairingPort: 37123,
    connectionPort: 5555,
    code: '123456',
  });

  assert.equal(result.ok, true);
  assert.equal(result.connected, true);
  assert.equal(result.device.serial, '192.168.1.25:5555');
  assert.deepEqual(fixture.calls.map((args) => args.slice(0, 2)), [
    ['pair', '192.168.1.25:37123'],
    ['connect', '192.168.1.25:5555'],
    ['devices', '-l'],
  ]);
});

test('wireless pairing rejects invalid credentials before invoking ADB', async () => {
  const fixture = createAdbManager([]);
  await assert.rejects(
    fixture.manager.pairDevice({
      host: 'not-an-ip',
      pairingPort: 1234,
      code: 'bad',
    }),
    /endereço IPv4 ou IPv6 válido/,
  );
  assert.equal(fixture.calls.length, 0);
});

test('wireless pairing validates the connection port before pairing', async () => {
  const fixture = createAdbManager([]);
  await assert.rejects(
    fixture.manager.pairDevice({
      host: '192.168.1.25',
      pairingPort: 37123,
      connectionPort: 70000,
      code: '123456',
    }),
    /Connection port must be a port/,
  );
  assert.equal(fixture.calls.length, 0);
});

test('wireless pairing finds the separate ADB connection port via mDNS', async () => {
  const fixture = createAdbManager([
    { stdout: 'Successfully paired to 192.168.1.25:37123', code: 0 },
    {
      stdout: 'adb-device._adb-tls-connect._tcp. 192.168.1.25:5555\n',
      code: 0,
    },
    { stdout: 'connected to 192.168.1.25:5555', code: 0 },
    {
      stdout: 'List of devices attached\n192.168.1.25:5555 device model:Pixel_9\n',
      code: 0,
    },
  ]);
  const result = await fixture.manager.pairDevice({
    host: '192.168.1.25',
    pairingPort: 37123,
    code: '654321',
  });
  assert.equal(result.connected, true);
  assert.equal(fixture.calls[1][0], 'mdns');
  assert.deepEqual(fixture.calls[2], ['connect', '192.168.1.25:5555']);
});

test('pairing stays paired when mDNS has no connect endpoint', async () => {
  const fixture = createAdbManager([
    { stdout: 'Successfully paired to 192.168.1.25:37123', code: 0 },
    { stdout: 'No services found', code: 0 },
  ]);
  const result = await fixture.manager.pairDevice({
    host: '192.168.1.25',
    pairingPort: 37123,
    code: '654321',
  });
  assert.equal(result.ok, true);
  assert.equal(result.paired, true);
  assert.equal(result.connected, false);
  assert.match(result.message, /porta ADB de conexão/);
});

test('ADB connect validates endpoint and confirms device discovery', async () => {
  const fixture = createAdbManager([
    { stdout: 'already connected to 192.168.1.25:5555', code: 0 },
    {
      stdout: 'List of devices attached\n192.168.1.25:5555 device\n',
      code: 0,
    },
  ]);
  const result = await fixture.manager.connectDevice({
    host: '192.168.1.25',
    connectionPort: 5555,
  });
  assert.equal(result.device.serial, '192.168.1.25:5555');
});

test('uploads install APKs and push other files with streamed progress', async () => {
  const fixture = createAdbManager([
    { stdout: 'Performing Streamed Install\nSuccess\n', code: 0 },
    {
      stdoutChunks: [
        '[ 3',
        '4%] /sdcard/Download/video.mp4\n[100%] video.mp4\n',
      ],
      code: 0,
    },
  ]);
  const progress = [];
  fixture.manager.on('transfer-progress', (event) => progress.push(event));
  const result = await fixture.manager.uploadFiles('device-1', [
    'C:\\uploads\\app.apk',
    'C:\\uploads\\video.mp4',
  ]);

  assert.deepEqual(fixture.calls, [
    ['-s', 'device-1', 'install', '-r', 'C:\\uploads\\app.apk'],
    ['-s', 'device-1', 'push', 'C:\\uploads\\video.mp4', '/sdcard/Download/'],
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
  assert.equal(progress.at(-1).percent, 100);
  assert.equal(progress.at(-1).complete, true);
  assert.ok(progress.some((event) => event.percent > 50 && event.percent < 100));
});

test('IPC generates pairing QR data and reports failed device operations', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const adbManager = new EventEmitter();
  adbManager.uploadFiles = async () => {
    throw new Error('device offline');
  };
  const scrcpyManager = new EventEmitter();
  const reportedErrors = [];
  scrcpyManager.reportDeviceError = (...args) => reportedErrors.push(args);
  registerIpcHandlers({
    ipcMain,
    adbManager,
    scrcpyManager,
    getWindows: () => [],
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    app: { getPath: () => 'C:\\Downloads' },
    settingsManager: {
      getTheme: () => 'green',
      setTheme: (theme) => theme,
    },
  });

  const qr = await handlers.get(CHANNELS.GENERATE_PAIRING_QR)(null, {
    host: '192.168.1.25',
    pairingPort: 37123,
    code: '123456',
  });
  assert.equal(qr.ok, true);
  assert.match(qr.dataUrl, /^data:image\/png;base64,/);

  const result = await handlers.get(CHANNELS.ADB_UPLOAD_FILES)(null, {
    serial: 'device-3',
    filePaths: ['C:\\file.apk'],
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, DEVICE_STATES.ERROR);
  assert.deepEqual(reportedErrors, [
    ['device-3', 'Falha ao enviar arquivos: device offline'],
  ]);

  assert.deepEqual(await handlers.get(CHANNELS.GET_THEME)(), {
    theme: 'green',
    color: '#a4f56b',
  });
  assert.deepEqual(
    await handlers.get(CHANNELS.SET_THEME)(null, 'purple'),
    { ok: true, theme: 'purple', color: '#b28cff' },
  );
});

test('download uses a safe basename and adb pull destination', async () => {
  const fixture = createAdbManager([
    { stdout: '1 file pulled', code: 0 },
  ]);
  const result = await fixture.manager.pullDownloadFile(
    'device-1',
    'photo.jpg',
    'C:\\Downloads\\photo.jpg',
  );
  assert.equal(result.ok, true);
  assert.deepEqual(fixture.calls[0], [
    '-s',
    'device-1',
    'pull',
    '/sdcard/Download/photo.jpg',
    'C:\\Downloads\\photo.jpg',
  ]);
  await assert.rejects(
    fixture.manager.pullDownloadFile('device-1', '..\\private.txt', 'C:\\x'),
    /nome do arquivo remoto é inválido/,
  );
});

test('Download explorer runs adb shell ls and returns parsed file rows', async () => {
  const fixture = createAdbManager([
    {
      stdout: '-rw-rw---- 1 u0_a123 media_rw 1024 2026-11-07 01:10 image.jpg\n',
      code: 0,
    },
  ]);
  const files = await fixture.manager.listDownloadFiles('device-1');
  assert.deepEqual(fixture.calls[0], [
    '-s',
    'device-1',
    'shell',
    'ls',
    '-l',
    '/sdcard/Download',
  ]);
  assert.deepEqual(files, [{
    name: 'image.jpg',
    size: 1024,
    date: '2026-11-07 01:10',
  }]);
});
