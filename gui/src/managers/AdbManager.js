const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isIP } = require('node:net');

const DOWNLOAD_DIRECTORY = '/sdcard/Download';
const TRANSFER_TIMEOUT_MS = 5 * 60 * 1000;

function parseDeviceList(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('List of devices attached')) {
      return [];
    }

    const [serial, state, ...properties] = trimmed.split(/\s+/);
    if (!serial || !state) {
      return [];
    }

    const device = {
      serial,
      state,
      model: '',
      product: '',
      device: '',
      transportId: '',
    };

    for (const property of properties) {
      const separator = property.indexOf(':');
      if (separator < 0) {
        continue;
      }

      const key = property.slice(0, separator);
      const value = property.slice(separator + 1);
      if (key === 'model') {
        device.model = value.replace(/_/g, ' ');
      } else if (key === 'product') {
        device.product = value;
      } else if (key === 'device') {
        device.device = value;
      } else if (key === 'transport_id') {
        device.transportId = value;
      }
    }

    return [device];
  });
}

function parseTransferProgress(output) {
  const percentages = [];
  const regex = /\[\s*(\d{1,3})%\]/g;
  for (const match of output.matchAll(regex)) {
    const percentage = Number(match[1]);
    if (percentage >= 0 && percentage <= 100) {
      percentages.push(percentage);
    }
  }
  return percentages;
}

function parseDownloadListing(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(
      /^-[-rwxStTs]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2})?\s+(.+)$/,
    );
    if (!match) {
      return [];
    }
    const name = match[4];
    if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
      return [];
    }
    return [{
      name,
      size: Number(match[1]),
      date: `${match[2]} ${match[3]}`,
    }];
  });
}

function validateSerial(serial) {
  if (typeof serial !== 'string' || !serial.trim() || serial.length > 256
      || serial.includes('\0')) {
    throw new TypeError('A valid ADB device serial is required.');
  }
  return serial;
}

function validatePort(port, label) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new TypeError(`${label} must be a port between 1 and 65535.`);
  }
  return value;
}

class AdbManager extends EventEmitter {
  constructor({
    adbExecutable,
    env = process.env,
    spawnProcess = spawn,
    timeoutMs = 10000,
    stat = fs.stat,
  }) {
    super();
    if (!adbExecutable) {
      throw new TypeError('An adb executable path is required.');
    }

    this.adbExecutable = adbExecutable;
    this.env = env;
    this.spawnProcess = spawnProcess;
    this.timeoutMs = timeoutMs;
    this.stat = stat;
    this.knownDevices = new Map();
  }

  async listDevices() {
    const { stdout, stderr } = await this.runAdb(['devices', '-l']);
    const devices = parseDeviceList(stdout);
    const current = new Map(devices.map((device) => [device.serial, device]));

    for (const device of devices) {
      if (!this.knownDevices.has(device.serial)) {
        this.emit('device-connected', device);
      }
      this.knownDevices.set(device.serial, device);
    }
    for (const [serial, previousDevice] of this.knownDevices) {
      if (!current.has(serial)) {
        this.knownDevices.delete(serial);
        this.emit('device-disconnected', previousDevice);
      }
    }

    return { devices, stderr };
  }

  async pairDevice({ host, pairingPort, code, connectionPort }) {
    const normalizedHost = String(host || '').trim();
    if (!isIP(normalizedHost)) {
      throw new TypeError('Informe um endereço IPv4 ou IPv6 válido.');
    }
    const pairPort = validatePort(pairingPort, 'Pairing port');
    const connectPort = connectionPort !== undefined && connectionPort !== ''
      ? validatePort(connectionPort, 'Connection port')
      : undefined;
    const pairingCode = String(code || '').trim();
    if (!/^\d{6}$/.test(pairingCode)) {
      throw new TypeError('O código de pareamento deve ter 6 dígitos.');
    }

    const pairAddress = this.formatAddress(normalizedHost, pairPort);
    const pairResult = await this.runAdb(
      ['pair', pairAddress, pairingCode],
      { timeoutMs: 30000 },
    );
    if (!/successfully paired/i.test(`${pairResult.stdout}\n${pairResult.stderr}`)) {
      throw new Error('O ADB não confirmou o pareamento. Confira o código e a porta.');
    }

    let address;
    if (connectPort !== undefined) {
      address = this.formatAddress(
        normalizedHost,
        connectPort,
      );
    } else {
      address = await this.findConnectionAddress(normalizedHost);
    }

    if (!address) {
      return {
        ok: true,
        paired: true,
        connected: false,
        message: 'Pareamento concluído. Não foi encontrada a porta ADB de conexão; informe-a para conectar.',
      };
    }

    const connectResult = await this.runAdb(['connect', address], {
      timeoutMs: 30000,
    });
    if (!/(connected to|already connected to)/i.test(
      `${connectResult.stdout}\n${connectResult.stderr}`,
    )) {
      throw new Error(
        `Pareamento concluído, mas o ADB não conectou em ${address}. Confira a porta de conexão.`,
      );
    }

    const { devices } = await this.listDevices();
    const device = devices.find((candidate) =>
      candidate.serial === address && candidate.state === 'device');
    if (!device) {
      throw new Error(
        `ADB conectou em ${address}, mas o dispositivo ainda não está pronto. Atualize a lista.`,
      );
    }
    return { ok: true, paired: true, connected: true, device };
  }

  async connectDevice({ host, connectionPort }) {
    const normalizedHost = String(host || '').trim();
    if (!isIP(normalizedHost)) {
      throw new TypeError('Informe um endereço IPv4 ou IPv6 válido.');
    }
    const address = this.formatAddress(
      normalizedHost,
      validatePort(connectionPort, 'Connection port'),
    );
    const result = await this.runAdb(['connect', address], {
      timeoutMs: 30000,
    });
    if (!/(connected to|already connected to)/i.test(
      `${result.stdout}\n${result.stderr}`,
    )) {
      throw new Error(`O ADB não conectou em ${address}.`);
    }
    const { devices } = await this.listDevices();
    const device = devices.find((candidate) =>
      candidate.serial === address && candidate.state === 'device');
    if (!device) {
      throw new Error(
        `ADB conectou em ${address}, mas o dispositivo ainda não está pronto.`,
      );
    }
    return { ok: true, paired: true, connected: true, device };
  }

  async findConnectionAddress(host) {
    try {
      const { stdout } = await this.runAdb(['mdns', 'services']);
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.includes('_adb-tls-connect._tcp') || !line.includes(host)) {
          continue;
        }
        const match = line.match(/((?:\d{1,3}\.){3}\d{1,3}|\[[\da-f:]+\]):(\d{1,5})/i);
        if (match && Number(match[2]) <= 65535) {
          return `${match[1]}:${match[2]}`;
        }
      }
    } catch (error) {
      this.emit('adb-warning', {
        message: `Não foi possível descobrir a porta de conexão via mDNS: ${error.message}`,
      });
    }
    return null;
  }

  formatAddress(host, port) {
    return isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
  }

  async listDownloadFiles(serial) {
    validateSerial(serial);
    const { stdout } = await this.runAdb([
      '-s',
      serial,
      'shell',
      'ls',
      '-l',
      DOWNLOAD_DIRECTORY,
    ]);
    return parseDownloadListing(stdout);
  }

  async uploadFiles(serial, filePaths) {
    validateSerial(serial);
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      throw new TypeError('Selecione pelo menos um arquivo para enviar.');
    }

    const files = [];
    for (const filePath of filePaths) {
      if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
        throw new TypeError('O caminho do arquivo enviado é inválido.');
      }
      const file = await this.stat(filePath);
      if (!file.isFile()) {
        throw new TypeError(`O caminho não é um arquivo: ${filePath}`);
      }
      files.push({
        path: filePath,
        name: path.basename(filePath),
        isApk: path.extname(filePath).toLowerCase() === '.apk',
      });
    }

    for (let index = 0; index < files.length; ++index) {
      const file = files[index];
      const operation = file.isApk ? 'install' : 'push';
      let lastPercent = 0;
      let pendingOutput = '';
      this.emitTransferProgress({
        serial,
        fileName: file.name,
        operation,
        fileIndex: index + 1,
        fileCount: files.length,
        percent: Math.floor((index / files.length) * 100),
      });
      const onOutput = (chunk) => {
        const output = pendingOutput + chunk;
        pendingOutput = output.slice(-32);
        for (const percent of parseTransferProgress(output)) {
          if (percent <= lastPercent) {
            continue;
          }
          lastPercent = percent;
          this.emitTransferProgress({
            serial,
            fileName: file.name,
            operation,
            fileIndex: index + 1,
            fileCount: files.length,
            percent: Math.min(
              99,
              Math.floor(((index + percent / 100) / files.length) * 100),
            ),
          });
        }
      };
      const args = file.isApk
        ? ['-s', serial, 'install', '-r', file.path]
        : ['-s', serial, 'push', file.path, `${DOWNLOAD_DIRECTORY}/`];
      await this.runAdb(args, {
        timeoutMs: TRANSFER_TIMEOUT_MS,
        onOutput,
      });
      this.emitTransferProgress({
        serial,
        fileName: file.name,
        operation,
        fileIndex: index + 1,
        fileCount: files.length,
        percent: Math.floor(((index + 1) / files.length) * 100),
        complete: index === files.length - 1,
      });
    }

    return { ok: true, count: files.length };
  }

  async pullDownloadFile(serial, name, localPath) {
    validateSerial(serial);
    if (typeof name !== 'string' || !name || name === '.' || name === '..'
        || /[\\/\0]/.test(name)) {
      throw new TypeError('O nome do arquivo remoto é inválido.');
    }
    if (typeof localPath !== 'string' || !path.isAbsolute(localPath)) {
      throw new TypeError('Escolha um caminho local para salvar o arquivo.');
    }

    await this.runAdb([
      '-s',
      serial,
      'pull',
      `${DOWNLOAD_DIRECTORY}/${name}`,
      localPath,
    ], { timeoutMs: TRANSFER_TIMEOUT_MS });
    return { ok: true, path: localPath };
  }

  emitTransferProgress(progress) {
    this.emit('transfer-progress', {
      ...progress,
      timestamp: new Date().toISOString(),
    });
  }

  runAdb(args, { timeoutMs = this.timeoutMs, onOutput } = {}) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawnProcess(this.adbExecutable, args, {
          env: this.env,
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        reject(new Error(`Could not start ADB: ${error.message}`));
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        try {
          child.kill();
          finish(new Error('ADB command timed out.'));
        } catch (error) {
          finish(new Error(`Could not stop timed-out ADB: ${error.message}`));
        }
      }, timeoutMs);

      const finish = (error, result) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        child.removeListener('error', onError);
        child.removeListener('close', onClose);
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      };

      const onError = (error) => {
        finish(new Error(`ADB process failed: ${error.message}`));
      };

      const onClose = (code, signal) => {
        if (code !== 0) {
          const reason = signal
            ? `ADB exited due to ${signal}.`
            : `ADB exited with code ${code}.`;
          finish(new Error(`${reason}${stderr ? ` ${stderr.trim()}` : ''}`));
          return;
        }
        finish(null, { stdout, stderr });
      };

      const collect = (stream) => (chunk) => {
        const text = chunk.toString();
        if (stream === 'stdout') {
          stdout += text;
        } else {
          stderr += text;
        }
        onOutput?.(text, stream);
      };

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', collect('stdout'));
      child.stderr.on('data', collect('stderr'));
      child.once('error', onError);
      child.once('close', onClose);
    });
  }
}

module.exports = {
  AdbManager,
  parseDeviceList,
  parseDownloadListing,
  parseTransferProgress,
};
