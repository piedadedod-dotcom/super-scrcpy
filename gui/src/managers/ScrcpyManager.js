const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { DEVICE_STATES, DeviceStateMachine } =
  require('../core/DeviceStateMachine');

const PROFILES = Object.freeze({
  default: Object.freeze({ label: 'Padrão', args: Object.freeze([]) }),
  gamer: Object.freeze({
    label: 'Gamer',
    args: Object.freeze(['--max-fps', '60', '--no-audio']),
  }),
  economy: Object.freeze({
    label: 'Economia',
    args: Object.freeze(['--max-size', '1024']),
  }),
});

function parseFpsOutput(output) {
  const values = [];
  const regex = /(?:^|[\s:])(\d+(?:\.\d+)?)\s*fps\b/gi;
  for (const match of output.matchAll(regex)) {
    const fps = Number(match[1]);
    if (Number.isFinite(fps) && fps >= 0 && fps <= 1000) {
      values.push(fps);
    }
  }
  return values;
}

class ScrcpyManager extends EventEmitter {
  static instance;

  static getInstance(options) {
    if (!ScrcpyManager.instance) {
      if (!options) {
        throw new Error('ScrcpyManager must be configured on first use.');
      }
      ScrcpyManager.instance = new ScrcpyManager(options);
    }
    return ScrcpyManager.instance;
  }

  constructor({
    scrcpyExecutable,
    adbExecutable,
    cwd,
    serverPath,
    serverFile,
    pathPrefix = '',
    env = process.env,
    spawnProcess = spawn,
    existsSync = fs.existsSync,
    mkdirSync = fs.mkdirSync,
    recordingDirectory = path.join(cwd || process.cwd(), 'recordings'),
  }) {
    super();
    if (!scrcpyExecutable || !adbExecutable || !cwd || !serverPath
        || !serverFile) {
      throw new TypeError('ScrcpyManager requires executable paths and cwd.');
    }

    this.scrcpyExecutable = scrcpyExecutable;
    this.adbExecutable = adbExecutable;
    this.cwd = cwd;
    this.serverPath = serverPath;
    this.serverFile = serverFile;
    this.pathPrefix = pathPrefix;
    this.env = env;
    this.spawnProcess = spawnProcess;
    this.existsSync = existsSync;
    this.mkdirSync = mkdirSync;
    this.recordingDirectory = recordingDirectory;
    this.sessions = new Map();
    this.processes = new Map();
    this.recordings = new Map();
    this.recordingOperations = new Map();
  }

  getSession(serial, device = {}) {
    let session = this.sessions.get(serial);
    if (!session) {
      const stateMachine = new DeviceStateMachine(serial);
      stateMachine.on('change', (event) => {
        this.emit('device-state', {
          ...event,
          canStop: this.processes.has(serial),
        });
      });
      session = {
        serial,
        device,
        profile: 'default',
        removeWhenStopped: false,
        stateMachine,
      };
      this.sessions.set(serial, session);
    } else {
      session.device = { ...session.device, ...device };
    }
    return session;
  }

  getStates() {
    return [...this.sessions.values()].map((session) => ({
      serial: session.serial,
      device: session.device,
      profile: session.profile,
      state: session.stateMachine.state,
      canStop: this.processes.has(session.serial),
      isRecording: this.recordings.has(session.serial),
      recordingPath: this.recordings.get(session.serial)?.path || null,
    }));
  }

  reportDeviceError(serial, message) {
    if (typeof serial !== 'string' || !serial.trim()) {
      return false;
    }

    const session = this.sessions.get(serial) || this.getSession(serial, {
      serial,
      state: 'offline',
    });
    if (session.stateMachine.state !== DEVICE_STATES.ERROR
        && session.stateMachine.canTransition(DEVICE_STATES.ERROR)) {
      session.stateMachine.transition(DEVICE_STATES.ERROR, {
        message,
        device: session.device,
      });
    }
    this.emit('scrcpy-error', { serial, message });
    return true;
  }

  checkPrerequisites() {
    const missing = [
      [this.scrcpyExecutable, 'scrcpy.exe'],
      [this.adbExecutable, 'adb.exe'],
      [this.serverFile, 'scrcpy server'],
    ].filter(([file]) => !this.existsSync(file));

    return {
      ok: missing.length === 0,
      missing: missing.map(([file, label]) => ({ file, label })),
    };
  }

  startDevice({
    serial,
    device = {},
    profile = 'default',
    isRecording = false,
    recordingPath,
  }) {
    if (typeof serial !== 'string' || !serial.trim()) {
      return { ok: false, state: DEVICE_STATES.ERROR, message: 'Device serial is required.' };
    }
    if (!Object.hasOwn(PROFILES, profile)) {
      return { ok: false, state: DEVICE_STATES.ERROR, message: 'Unknown scrcpy profile.' };
    }

    const prerequisites = this.checkPrerequisites();
    if (!prerequisites.ok) {
      const message = prerequisites.missing
        .map(({ label, file }) => `${label} não encontrado: ${file}`)
        .join('\n');
      const session = this.getSession(serial, device);
      if (session.stateMachine.state === DEVICE_STATES.IDLE) {
        session.stateMachine.transition(DEVICE_STATES.STARTING);
      }
      if (session.stateMachine.canTransition(DEVICE_STATES.ERROR)) {
        session.stateMachine.transition(DEVICE_STATES.ERROR, { message });
      }
      this.emit('scrcpy-error', { serial, message });
      return { ok: false, state: DEVICE_STATES.ERROR, message };
    }

    const session = this.getSession(serial, device);
    if (this.processes.has(serial)) {
      return {
        ok: false,
        state: session.stateMachine.state,
        message: 'scrcpy is already running for this device.',
      };
    }
    if (!session.stateMachine.canTransition(DEVICE_STATES.STARTING)) {
      return {
        ok: false,
        state: session.stateMachine.state,
        message: `Cannot start a device in state ${session.stateMachine.state}.`,
      };
    }

    let activeRecordingPath;
    if (isRecording) {
      try {
        this.mkdirSync(this.recordingDirectory, { recursive: true });
        activeRecordingPath = recordingPath
          || path.join(
            this.recordingDirectory,
            `gravacao_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`,
          );
        if (path.extname(activeRecordingPath).toLowerCase() !== '.mp4') {
          throw new TypeError('O caminho da gravação deve terminar em .mp4.');
        }
      } catch (error) {
        const message = `Não foi possível preparar a gravação: ${error.message}`;
        if (session.stateMachine.canTransition(DEVICE_STATES.ERROR)) {
          session.stateMachine.transition(DEVICE_STATES.ERROR, { message });
        }
        this.emit('scrcpy-error', { serial, message });
        return { ok: false, state: DEVICE_STATES.ERROR, message };
      }
    }

    session.profile = profile;
    session.stateMachine.transition(DEVICE_STATES.STARTING, {
      profile,
      isRecording,
      recordingPath: activeRecordingPath || null,
    });
    const args = [
      '-s',
      serial,
      '--print-fps',
      ...PROFILES[profile].args,
    ];
    if (isRecording) {
      args.push(`--record=${activeRecordingPath}`);
    }

    let child;
    try {
      child = this.spawnProcess(this.scrcpyExecutable, args, {
        cwd: this.cwd,
        env: {
          ...this.env,
          ADB: this.adbExecutable,
          SCRCPY_SERVER_PATH: this.serverPath,
          PATH: `${this.pathPrefix}${this.env.PATH || ''}`,
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (error) {
      this.failStart(session, error);
      return { ok: false, state: DEVICE_STATES.ERROR, message: error.message };
    }

    const processEntry = {
      child,
      session,
      spawned: false,
      stopPromise: null,
      recordingPath: activeRecordingPath,
      stdoutRemainder: '',
    };
    this.processes.set(serial, processEntry);
    if (activeRecordingPath) {
      this.recordings.set(serial, { path: activeRecordingPath });
      this.emit('recording-changed', {
        serial,
        isRecording: true,
        path: activeRecordingPath,
      });
    }
    child.stdout.on('data', (data) => {
      const output = data.toString();
      this.emit('scrcpy-stdout', { serial, message: output });
      const fpsOutput = processEntry.stdoutRemainder + output;
      const lines = fpsOutput.split(/\r?\n/);
      processEntry.stdoutRemainder = lines.pop() || '';
      for (const fps of parseFpsOutput(lines.join('\n'))) {
        this.emit('fps-update', { serial, fps, timestamp: Date.now() });
      }
    });
    child.stderr.on('data', (data) => {
      this.emit('scrcpy-stderr', { serial, message: data.toString() });
    });
    child.once('spawn', () => {
      processEntry.spawned = true;
      if (this.processes.get(serial) === processEntry
          && session.stateMachine.state === DEVICE_STATES.STARTING) {
        session.stateMachine.transition(DEVICE_STATES.RUNNING);
      }
    });
    child.on('error', (error) => {
      const message = `scrcpy process error: ${error.message}`;
      this.emit('scrcpy-error', { serial, message });
      if (!processEntry.spawned && child.pid === undefined
          && this.processes.get(serial) === processEntry) {
        this.processes.delete(serial);
        if (processEntry.recordingPath) {
          this.recordings.delete(serial);
          this.emit('recording-changed', {
            serial,
            isRecording: false,
            path: processEntry.recordingPath,
            error: message,
          });
        }
        this.failStart(session, error);
        if (processEntry.resolveStop) {
          processEntry.resolveStop({
            ok: false,
            state: DEVICE_STATES.ERROR,
            message,
          });
        }
        if (processEntry.session.removeWhenStopped) {
          this.sessions.delete(serial);
        }
      }
    });
    child.once('close', (code, signal) => {
      if (this.processes.get(serial) !== processEntry) {
        return;
      }
      this.processes.delete(serial);

      const state = session.stateMachine.state;
      if (state === DEVICE_STATES.STOPPING || code === 0) {
        session.stateMachine.transition(DEVICE_STATES.IDLE, { code, signal });
      } else {
        const message = signal
          ? `scrcpy encerrado pelo sinal ${signal}.`
          : `scrcpy terminou com código ${code}.`;
        session.stateMachine.transition(DEVICE_STATES.ERROR, {
          code,
          signal,
          message,
        });
        this.emit('scrcpy-error', { serial, message, code, signal });
      }
      if (processEntry.resolveStop) {
        processEntry.resolveStop({
          ok: true,
          state: session.stateMachine.state,
        });
      }
      if (processEntry.recordingPath) {
        this.recordings.delete(serial);
        const recordingResult = {
          serial,
          isRecording: false,
          path: processEntry.recordingPath,
          error: code === 0 || state === DEVICE_STATES.STOPPING
            ? undefined
            : `scrcpy terminou com código ${code}.`,
        };
        this.emit('recording-changed', recordingResult);
      }
      if (session.removeWhenStopped) {
        this.sessions.delete(serial);
      }
    });

    return { ok: true, state: DEVICE_STATES.STARTING, serial, profile };
  }

  toggleRecording(serial) {
    const pending = this.recordingOperations.get(serial);
    if (pending) {
      return pending;
    }
    const operation = this.performToggleRecording(serial)
      .finally(() => this.recordingOperations.delete(serial));
    this.recordingOperations.set(serial, operation);
    return operation;
  }

  async performToggleRecording(serial) {
    const session = this.sessions.get(serial);
    const existingRecording = this.recordings.get(serial);
    const processEntry = this.processes.get(serial);
    if (existingRecording && processEntry?.recordingPath) {
      const stopped = await this.stopDevice(serial);
      if (!stopped.ok || stopped.state !== DEVICE_STATES.IDLE) {
        return {
          ...stopped,
          isRecording: true,
          path: existingRecording.path,
        };
      }
      return {
        ok: true,
        state: DEVICE_STATES.IDLE,
        isRecording: false,
        path: existingRecording.path,
      };
    }

    if (!session) {
      return {
        ok: false,
        state: DEVICE_STATES.ERROR,
        message: 'Dispositivo não encontrado para gravação.',
      };
    }
    const profile = session.profile || 'default';
    const device = session.device;
    if (processEntry) {
      const stopped = await this.stopDevice(serial);
      if (!stopped.ok || stopped.state !== DEVICE_STATES.IDLE) {
        return stopped;
      }
    }

    const started = this.startDevice({
      serial,
      device,
      profile,
      isRecording: true,
    });
    return {
      ...started,
      isRecording: started.ok,
      path: started.ok ? this.recordings.get(serial)?.path : undefined,
    };
  }

  failStart(session, error) {
    const message = `Não foi possível iniciar o scrcpy: ${error.message}`;
    if (session.stateMachine.canTransition(DEVICE_STATES.ERROR)) {
      session.stateMachine.transition(DEVICE_STATES.ERROR, { message });
    }
    this.emit('scrcpy-error', { serial: session.serial, message });
  }

  stopDevice(serial) {
    const session = this.sessions.get(serial);
    const processEntry = this.processes.get(serial);
    if (!session || !processEntry) {
      return Promise.resolve({
        ok: Boolean(session),
        state: session?.stateMachine.state ?? DEVICE_STATES.IDLE,
      });
    }
    if (processEntry.stopPromise) {
      return processEntry.stopPromise;
    }
    if (!session.stateMachine.canTransition(DEVICE_STATES.STOPPING)) {
      return Promise.resolve({
        ok: false,
        state: session.stateMachine.state,
        message: `Cannot stop a device in state ${session.stateMachine.state}.`,
      });
    }

    session.stateMachine.transition(DEVICE_STATES.STOPPING);
    const stopPromise = new Promise((resolve) => {
      processEntry.resolveStop = resolve;
    });
    processEntry.stopPromise = stopPromise;

    const requestKill = () => {
      if (this.processes.get(serial) !== processEntry) {
        return;
      }
      if (processEntry.child.exitCode !== null
          || processEntry.child.signalCode !== null) {
        return;
      }
      try {
        if (!processEntry.child.kill()) {
          const message = 'O sistema não aceitou o encerramento do scrcpy.';
          session.stateMachine.transition(DEVICE_STATES.ERROR, { message });
          this.emit('scrcpy-error', { serial, message });
          processEntry.stopPromise = null;
          processEntry.resolveStop({ ok: false, state: DEVICE_STATES.ERROR, message });
        }
      } catch (error) {
        const message = `Não foi possível encerrar o scrcpy: ${error.message}`;
        session.stateMachine.transition(DEVICE_STATES.ERROR, { message });
        this.emit('scrcpy-error', { serial, message });
        processEntry.stopPromise = null;
        processEntry.resolveStop({ ok: false, state: DEVICE_STATES.ERROR, message });
      }
    };

    if (processEntry.child.pid === undefined
        && processEntry.child.exitCode === null
        && processEntry.child.signalCode === null) {
      processEntry.child.once('spawn', requestKill);
    } else {
      requestKill();
    }

    return stopPromise;
  }

  stopAll() {
    return Promise.all([...this.processes.keys()].map((serial) =>
      this.stopDevice(serial)));
  }

  removeDevice(serial) {
    const processEntry = this.processes.get(serial);
    if (processEntry) {
      processEntry.session.removeWhenStopped = true;
      return false;
    }

    return this.sessions.delete(serial);
  }
}

module.exports = { PROFILES, ScrcpyManager, parseFpsOutput };
