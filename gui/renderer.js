const IPC_CHANNELS = window.SCRCPY_IPC_CHANNELS;

const STATES = Object.freeze({
  IDLE: 'IDLE',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  ERROR: 'ERROR',
  STOPPING: 'STOPPING',
});

const STATE_LABELS = Object.freeze({
  [STATES.IDLE]: 'Parado',
  [STATES.STARTING]: 'Iniciando...',
  [STATES.RUNNING]: 'Rodando...',
  [STATES.ERROR]: 'Erro',
  [STATES.STOPPING]: 'Encerrando...',
});

const THEME_NAMES = Object.freeze({
  green: 'Verde Neon',
  purple: 'Roxo',
  blue: 'Azul',
  orange: 'Laranja',
});

class CommandCenter {
  constructor() {
    if (!IPC_CHANNELS?.ADB_LIST_DEVICES) {
      throw new Error('Os canais IPC compartilhados não foram carregados.');
    }
    this.devices = new Map();
    this.selectedSerial = null;
    this.discoveryDevices = [];
    this.selectedDiscoverySerial = null;
    this.logs = new Map();
    this.toastTimeout = null;
    this.toastHideTimeout = null;
    this.qrRequestId = 0;
    this.qrTimeout = null;
    this.pairCompleted = false;
    this.uploadingSerials = new Set();
    this.fpsHistory = new Map();
    this.fpsChart = null;
    this.recordingRequests = new Set();
    this.chartUnavailableReported = false;
    this.currentView = 'devices';
    this.bindElements();
    this.bindEvents();
    this.initialize();
  }

  bindElements() {
    this.tabs = document.querySelector('#device-tabs');
    this.panel = document.querySelector('#device-panel');
    this.emptyState = document.querySelector('#empty-state');
    this.sessionContent = document.querySelector('#session-content');
    this.sessionTitle = document.querySelector('#session-title');
    this.statusLabel = document.querySelector('#status-label');
    this.statusDetail = document.querySelector('#status-detail');
    this.statusIcon = document.querySelector('#status-icon');
    this.startButton = document.querySelector('#start-button');
    this.stopButton = document.querySelector('#stop-button');
    this.startLabel = document.querySelector('#start-label');
    this.profileSelect = document.querySelector('#profile-select');
    this.logPanel = document.querySelector('#log-panel');
    this.logOutput = document.querySelector('#log-output');
    this.logsButton = document.querySelector('#logs-button');
    this.logDeviceLabel = document.querySelector('#log-device-label');
    this.dialog = document.querySelector('#device-dialog');
    this.discoveryStatus = document.querySelector('#discovery-status');
    this.deviceList = document.querySelector('#device-list');
    this.addDeviceButton = document.querySelector('#add-device');
    this.toast = document.querySelector('#error-toast');
    this.toastMessage = document.querySelector('#toast-message');
    this.filePicker = document.querySelector('#file-picker');
    this.dropzone = document.querySelector('#file-dropzone');
    this.transferStatus = document.querySelector('#transfer-status');
    this.transferLabel = document.querySelector('#transfer-label');
    this.transferPercent = document.querySelector('#transfer-percent');
    this.transferProgress = document.querySelector('#transfer-progress');
    this.filesDeviceSelect = document.querySelector('#files-device-select');
    this.fileListStatus = document.querySelector('#file-list-status');
    this.fileTableBody = document.querySelector('#file-table-body');
    this.wirelessDialog = document.querySelector('#wireless-dialog');
    this.wirelessForm = document.querySelector('#wireless-form');
    this.wirelessStatus = document.querySelector('#wireless-status');
    this.pairButton = document.querySelector('#pair-device');
    this.pairingQr = document.querySelector('#pairing-qr');
    this.pairingFields = {
      host: document.querySelector('#wireless-host'),
      pairingPort: document.querySelector('#wireless-pair-port'),
      connectionPort: document.querySelector('#wireless-connect-port'),
      code: document.querySelector('#wireless-code'),
    };
    this.recordButton = document.querySelector('#record-button');
    this.recordLabel = document.querySelector('#record-label');
    this.fpsValue = document.querySelector('#fps-value');
    this.fpsCanvas = document.querySelector('#fps-chart');
    this.settingsButton = document.querySelector('#settings-button');
    this.settingsDialog = document.querySelector('#settings-dialog');
  }

  bindEvents() {
    document.querySelector('#new-connection').addEventListener('click', () =>
      this.openDiscovery());
    document.querySelector('#empty-connect').addEventListener('click', () =>
      this.openDiscovery());
    document.querySelector('#wireless-connection').addEventListener('click', () =>
      this.openWirelessDialog());
    document.querySelector('#refresh-devices').addEventListener('click', () =>
      this.refreshDevices());
    this.addDeviceButton.addEventListener('click', () => this.addSelectedDevice());
    this.startButton.addEventListener('click', () => this.startSelectedDevice());
    this.stopButton.addEventListener('click', () => this.stopSelectedDevice());
    this.recordButton.addEventListener('click', () => this.toggleSelectedRecording());
    this.settingsButton.addEventListener('click', () =>
      this.settingsDialog.showModal());
    this.settingsDialog.querySelector('.dialog-close').addEventListener('click', () =>
      this.settingsDialog.close());
    for (const button of this.settingsDialog.querySelectorAll('[data-theme]')) {
      button.addEventListener('click', () =>
        this.setTheme(button.dataset.theme));
    }
    document.querySelector('#devices-view-tab').addEventListener('click', () =>
      this.switchView('devices'));
    document.querySelector('#files-view-tab').addEventListener('click', () =>
      this.switchView('files'));
    document.querySelector('#refresh-files').addEventListener('click', () =>
      this.refreshFiles());
    this.filesDeviceSelect.addEventListener('change', () => this.refreshFiles());
    this.filePicker.addEventListener('change', () => {
      this.uploadFiles(this.filePicker.files);
      this.filePicker.value = '';
    });
    for (const eventName of ['dragenter', 'dragover']) {
      this.dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        this.dropzone.classList.add('is-dragging');
      });
    }
    this.dropzone.addEventListener('dragleave', (event) => {
      if (!this.dropzone.contains(event.relatedTarget)) {
        this.dropzone.classList.remove('is-dragging');
      }
    });
    this.dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      this.dropzone.classList.remove('is-dragging');
      this.uploadFiles(event.dataTransfer.files);
    });
    document.querySelector('#pair-device').addEventListener('click', () =>
      this.pairWirelessDevice());
    this.wirelessForm.addEventListener('submit', (event) => event.preventDefault());
    this.wirelessForm.querySelector('.dialog-close').addEventListener('click', () =>
      this.wirelessDialog.close());
    for (const [key, field] of Object.entries(this.pairingFields)) {
      field.addEventListener('input', () => {
        if (key !== 'connectionPort') {
          this.pairCompleted = false;
        }
        this.schedulePairingQr();
      });
    }
    this.logsButton.addEventListener('click', () =>
      this.showLogs(this.logPanel.hidden));
    document.querySelector('#clear-logs').addEventListener('click', () => {
      if (this.selectedSerial) {
        this.logs.set(this.selectedSerial, []);
      }
      this.renderLogs();
    });
    document.querySelector('#toast-dismiss').addEventListener('click', () =>
      this.hideToast());

    window.scrcpy.onEvent(IPC_CHANNELS.ADB_DEVICE_CONNECTED,
      (device) => this.onDeviceConnected(device));
    window.scrcpy.onEvent(IPC_CHANNELS.ADB_DEVICE_DISCONNECTED,
      (device) => this.onDeviceDisconnected(device));
    window.scrcpy.onEvent(IPC_CHANNELS.DEVICE_STATE_CHANGED,
      (event) => this.onDeviceState(event));
    window.scrcpy.onEvent(IPC_CHANNELS.SCRCPY_STDOUT,
      (log) => this.appendLog(log, 'stdout'));
    window.scrcpy.onEvent(IPC_CHANNELS.SCRCPY_STDERR,
      (log) => this.appendLog(log, 'stderr'));
    window.scrcpy.onEvent(IPC_CHANNELS.SCRCPY_ERROR, (error) => {
      this.appendLog(error, 'error');
      this.showLogs(true);
      this.showToast(error.message || 'Ocorreu um erro no scrcpy.', 'error');
    });
    window.scrcpy.onEvent(IPC_CHANNELS.ADB_TRANSFER_PROGRESS,
      (progress) => this.onTransferProgress(progress));
    window.scrcpy.onEvent(IPC_CHANNELS.FPS_UPDATE,
      (metrics) => this.onFpsUpdate(metrics));
    window.scrcpy.onEvent(IPC_CHANNELS.RECORDING_CHANGED,
      (recording) => this.onRecordingChanged(recording));
  }

  async initialize() {
    try {
      const prerequisites = await window.scrcpy.checkPrerequisites();
      if (!prerequisites.ok) {
        const message = prerequisites.missing
          .map(({ label, file }) => `${label} não encontrado: ${file}`)
          .join('\n');
        this.showToast(message);
        this.appendLog({ message }, 'error');
        this.showLogs(true);
      }

      const states = await window.scrcpy.getDeviceStates();
      for (const session of states) {
        this.devices.set(session.serial, {
          serial: session.serial,
          device: session.device || { serial: session.serial },
          profile: session.profile || 'default',
          state: session.state || STATES.IDLE,
          canStop: Boolean(session.canStop),
          connected: true,
          isRecording: Boolean(session.isRecording),
          recordingPath: session.recordingPath || null,
        });
      }
      if (this.devices.size) {
        this.selectedSerial = this.devices.keys().next().value;
      }
      this.render();
    } catch (error) {
      this.showToast(`Falha ao inicializar a interface: ${error.message}`);
    }
  }

  async openDiscovery() {
    this.selectedDiscoverySerial = null;
    this.addDeviceButton.disabled = true;
    this.renderDiscovery([]);
    if (!this.dialog.open) {
      this.dialog.showModal();
    }
    await this.refreshDevices();
  }

  openWirelessDialog() {
    if (this.dialog.open) {
      this.dialog.close();
    }
    this.wirelessStatus.textContent = '';
    this.wirelessDialog.showModal();
    this.schedulePairingQr();
  }

  schedulePairingQr() {
    clearTimeout(this.qrTimeout);
    this.qrTimeout = setTimeout(() => this.updatePairingQr(), 300);
  }

  async updatePairingQr() {
    const request = Object.fromEntries(
      Object.entries(this.pairingFields).map(([key, field]) =>
        [key, field.value.trim()]),
    );
    const readyForPair = request.host && request.pairingPort
      && /^\d{6}$/.test(request.code);
    const readyForConnect = this.pairCompleted
      && request.host && request.connectionPort;
    if (!readyForPair) {
      this.pairingQr.replaceChildren();
      const hint = document.createElement('span');
      hint.textContent = 'Preencha IP, porta e código para gerar o QR.';
      this.pairingQr.append(hint);
    } else {
      const requestId = ++this.qrRequestId;
      try {
        const result = await window.scrcpy.generatePairingQr(request);
        if (requestId !== this.qrRequestId) {
          return;
        }
        this.pairingQr.replaceChildren();
        if (!result.ok) {
          this.pairingQr.textContent = result.message;
        } else {
          const image = document.createElement('img');
          image.src = result.dataUrl;
          image.alt = 'QR Code com as credenciais de pareamento ADB';
          this.pairingQr.append(image);
        }
      } catch (error) {
        this.pairingQr.textContent = `Falha ao gerar QR: ${error.message}`;
      }
    }
    this.pairButton.disabled = this.pairCompleted
      ? !readyForConnect
      : !readyForPair;
    this.pairButton.textContent = this.pairCompleted
      ? 'Conectar dispositivo'
      : 'Parear e conectar';
  }

  async pairWirelessDevice() {
    if (!this.wirelessForm.reportValidity()) {
      return;
    }
    const request = Object.fromEntries(
      Object.entries(this.pairingFields).map(([key, field]) =>
        [key, field.value.trim()]),
    );
    if (request.connectionPort) request.connectionPort = Number(request.connectionPort);
    if (request.pairingPort) request.pairingPort = Number(request.pairingPort);

    this.pairButton.disabled = true;
    this.pairButton.textContent = this.pairCompleted ? 'Conectando...' : 'Pareando...';
    this.wirelessStatus.classList.add('is-loading');
    this.wirelessStatus.textContent = this.pairCompleted
      ? 'Executando adb connect...'
      : 'Executando adb pair...';
    try {
      const result = this.pairCompleted
        ? await window.scrcpy.connectDevice(request)
        : await window.scrcpy.pairDevice(request);
      if (!result.ok) {
        this.wirelessStatus.textContent = result.message;
        return;
      }
      if (!result.connected || !result.device) {
        this.pairCompleted = true;
        this.wirelessStatus.textContent = result.message;
        this.pairButton.textContent = 'Conectar dispositivo';
        this.schedulePairingQr();
        return;
      }

      const device = result.device;
      this.devices.set(device.serial, this.devices.get(device.serial) || {
        serial: device.serial,
        device,
        profile: 'default',
        state: STATES.IDLE,
        canStop: false,
        connected: true,
      });
      this.devices.get(device.serial).device = device;
      this.devices.get(device.serial).connected = true;
      this.selectedSerial = device.serial;
      this.pairCompleted = false;
      this.wirelessDialog.close();
      this.switchView('devices');
      this.render();
      this.showToast(`Conectado via Wi-Fi: ${this.deviceName(this.devices.get(device.serial))}.`, 'success');
    } catch (error) {
      this.wirelessStatus.textContent = `Falha no pareamento: ${error.message}`;
    } finally {
      this.wirelessStatus.classList.remove('is-loading');
      this.schedulePairingQr();
    }
  }

  switchView(view) {
    this.currentView = view;
    const devicesVisible = view === 'devices';
    document.querySelector('#devices-view').hidden = !devicesVisible;
    document.querySelector('#files-view').hidden = devicesVisible;
    document.querySelector('#devices-view-tab').classList.toggle('is-selected', devicesVisible);
    document.querySelector('#files-view-tab').classList.toggle('is-selected', !devicesVisible);
    document.querySelector('#devices-view-tab').setAttribute('aria-selected', String(devicesVisible));
    document.querySelector('#files-view-tab').setAttribute('aria-selected', String(!devicesVisible));
    if (!devicesVisible) {
      this.updateFileDeviceOptions();
      this.refreshFiles();
    }
  }

  updateFileDeviceOptions() {
    const previousSerial = this.filesDeviceSelect.value;
    const available = [...this.devices.values()].filter((session) =>
      session.connected
      && session.device?.state !== 'offline'
      && session.device?.state !== 'unauthorized');
    this.filesDeviceSelect.replaceChildren();
    for (const session of available) {
      const option = document.createElement('option');
      option.value = session.serial;
      option.textContent = this.deviceName(session);
      this.filesDeviceSelect.append(option);
    }
    if (available.some((session) => session.serial === previousSerial)) {
      this.filesDeviceSelect.value = previousSerial;
    } else if (available.some((session) => session.serial === this.selectedSerial)) {
      this.filesDeviceSelect.value = this.selectedSerial;
    }
    this.filesDeviceSelect.disabled = available.length === 0;
  }

  async refreshFiles() {
    const serial = this.filesDeviceSelect.value;
    this.fileTableBody.replaceChildren();
    if (!serial) {
      this.fileListStatus.textContent = 'Adicione ou conecte um dispositivo para explorar arquivos.';
      return;
    }
    this.fileListStatus.classList.add('is-loading');
    this.fileListStatus.textContent = 'Carregando arquivos...';
    try {
      const result = await window.scrcpy.listDownloadFiles(serial);
      if (!result.ok) {
        this.fileListStatus.textContent = result.message;
        return;
      }
      this.renderFiles(serial, result.files);
    } catch (error) {
      this.fileListStatus.textContent = `Falha ao listar arquivos: ${error.message}`;
    } finally {
      this.fileListStatus.classList.remove('is-loading');
    }
  }

  renderFiles(serial, files) {
    this.fileTableBody.replaceChildren();
    this.fileListStatus.textContent = files.length
      ? `${files.length} arquivo(s) em /sdcard/Download.`
      : 'A pasta /sdcard/Download está vazia.';
    for (const file of files) {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      name.className = 'file-name';
      name.textContent = file.name;
      const size = document.createElement('td');
      size.textContent = this.formatFileSize(file.size);
      const date = document.createElement('td');
      date.textContent = file.date;
      const action = document.createElement('td');
      const download = document.createElement('button');
      download.type = 'button';
      download.className = 'button button-logs file-download';
      download.textContent = 'Baixar';
      download.addEventListener('click', () => this.downloadFile(serial, file.name, download));
      action.append(download);
      row.append(name, size, date, action);
      this.fileTableBody.append(row);
    }
  }

  async downloadFile(serial, name, button) {
    button.disabled = true;
    button.textContent = 'Baixando...';
    try {
      const result = await window.scrcpy.pullDownloadFile(serial, name);
      if (result.canceled) {
        return;
      }
      if (result.ok) {
        this.showToast(`Arquivo salvo em: ${result.path}`, 'success');
      }
    } catch (error) {
      this.showToast(`Falha ao baixar ${name}: ${error.message}`, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Baixar';
    }
  }

  async uploadFiles(fileList) {
    const session = this.devices.get(this.selectedSerial);
    const files = Array.from(fileList || []);
    if (!session || !files.length || this.uploadingSerials.has(session.serial)) {
      return;
    }

    this.uploadingSerials.add(session.serial);
    session.uploading = true;
    this.transferStatus.hidden = false;
    session.transfer = {
      percent: 0,
      fileName: files[0].name,
      operation: files[0].name.toLowerCase().endsWith('.apk') ? 'install' : 'push',
      fileIndex: 1,
      fileCount: files.length,
      complete: false,
    };
    this.transferProgress.value = 0;
    this.transferPercent.textContent = '0%';
    this.transferLabel.textContent = `Enviando ${files.length} arquivo(s)...`;
    this.dropzone.classList.add('is-uploading');
    try {
      const result = await window.scrcpy.uploadDroppedFiles(session.serial, files);
      if (result.ok) {
        session.transfer = {
          ...session.transfer,
          percent: 100,
          complete: true,
        };
        this.transferProgress.value = 100;
        this.transferPercent.textContent = '100%';
        this.transferLabel.textContent = 'Transferência concluída.';
        this.showToast(`${result.count} arquivo(s) enviados para ${this.deviceName(session)}.`, 'success');
        if (this.currentView === 'files') {
          this.refreshFiles();
        }
      } else {
        session.transfer = {
          ...session.transfer,
          error: true,
          message: result.message,
        };
      }
    } catch (error) {
      session.transfer = {
        ...session.transfer,
        error: true,
        message: error.message,
      };
      this.showToast(`Falha ao enviar arquivos: ${error.message}`, 'error');
    } finally {
      this.uploadingSerials.delete(session.serial);
      session.uploading = false;
      this.dropzone.classList.remove('is-uploading');
      this.render();
    }
  }

  onTransferProgress(progress) {
    const session = this.devices.get(progress.serial);
    if (session) {
      session.transfer = progress;
    }
    if (progress.serial !== this.selectedSerial) {
      return;
    }
    this.transferStatus.hidden = false;
    this.transferProgress.value = progress.percent;
    this.transferPercent.textContent = `${progress.percent}%`;
    const verb = progress.operation === 'install' ? 'Instalando' : 'Enviando';
    this.transferLabel.textContent =
      `${verb} ${progress.fileName} (${progress.fileIndex}/${progress.fileCount})`;
  }

  formatFileSize(bytes) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }

  async refreshDevices() {
    this.discoveryStatus.classList.add('is-loading');
    this.discoveryStatus.replaceChildren();
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const loadingText = document.createElement('span');
    loadingText.textContent = 'Buscando dispositivos...';
    this.discoveryStatus.append(spinner, loadingText);
    this.deviceList.replaceChildren();
    this.addDeviceButton.disabled = true;

    try {
      const result = await window.scrcpy.listDevices();
      if (!result.ok) {
        this.discoveryStatus.classList.remove('is-loading');
        this.discoveryStatus.textContent = `Falha ao buscar dispositivos: ${result.message}`;
        this.showToast(`Falha ao buscar dispositivos: ${result.message}`);
        return;
      }
      this.renderDiscovery(result.devices || []);
      if (result.stderr?.trim()) {
        this.appendLog({ message: result.stderr.trim() }, 'stderr');
      }
    } catch (error) {
      this.discoveryStatus.classList.remove('is-loading');
      this.discoveryStatus.textContent = `Falha ao buscar dispositivos: ${error.message}`;
      this.showToast(`Falha ao buscar dispositivos: ${error.message}`);
    }
  }

  renderDiscovery(devices) {
    this.discoveryDevices = devices;
    this.discoveryStatus.classList.remove('is-loading');
    this.deviceList.replaceChildren();
    if (!devices.length) {
      this.discoveryStatus.textContent = 'Nenhum dispositivo ADB encontrado.';
      return;
    }

    const readyCount = devices.filter((device) => device.state === 'device').length;
    this.discoveryStatus.textContent = readyCount
      ? `${readyCount} dispositivo(s) disponível(is).`
      : 'Dispositivos encontrados, mas nenhum está autorizado e pronto.';

    for (const device of devices) {
      const alreadyAdded = this.devices.has(device.serial);
      const ready = device.state === 'device' && !alreadyAdded;
      const label = document.createElement('label');
      label.className = 'discovery-device';
      label.classList.toggle('is-unavailable', !ready);

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'adb-device';
      radio.value = device.serial;
      radio.disabled = !ready;
      radio.checked = this.selectedDiscoverySerial === device.serial;
      radio.addEventListener('change', () => {
        this.selectedDiscoverySerial = device.serial;
        this.addDeviceButton.disabled = false;
      });

      const details = document.createElement('span');
      details.className = 'discovery-device-details';
      const title = document.createElement('strong');
      title.textContent = device.model || device.serial;
      const subtitle = document.createElement('small');
      subtitle.textContent = device.model
        ? `${device.serial} · ${this.describeDeviceState(device.state)}`
        : this.describeDeviceState(device.state);
      details.append(title, subtitle);

      const state = document.createElement('span');
      state.className = `device-state device-state-${device.state}`;
      state.textContent = alreadyAdded ? 'Adicionado' : this.describeDeviceState(device.state);
      label.append(radio, details, state);
      this.deviceList.append(label);
    }
  }

  addSelectedDevice() {
    const device = this.discoveryDevices.find((candidate) =>
      candidate.serial === this.selectedDiscoverySerial);
    if (!device || device.state !== 'device') {
      return;
    }

    if (!this.devices.has(device.serial)) {
      this.devices.set(device.serial, {
        serial: device.serial,
        device,
        profile: 'default',
        state: STATES.IDLE,
        canStop: false,
        connected: true,
      });
    }
    this.selectedSerial = device.serial;
    this.dialog.close();
    this.render();
  }

  onDeviceConnected(device) {
    const session = this.devices.get(device.serial);
    if (session) {
      session.device = device;
      session.connected = true;
      this.render();
    }
  }

  onDeviceDisconnected(device) {
    const session = this.devices.get(device.serial);
    if (!session) {
      return;
    }
    session.connected = false;
    if (this.currentView === 'files') {
      this.updateFileDeviceOptions();
    }
    if (this.selectedSerial === device.serial) {
      this.render();
    }
  }

  onDeviceState(event) {
    if (!event?.serial || !Object.values(STATES).includes(event.state)) {
      return;
    }
    let session = this.devices.get(event.serial);
    if (!session) {
      session = {
        serial: event.serial,
        device: event.device || { serial: event.serial },
        profile: event.profile || 'default',
        connected: event.device?.state !== 'offline',
        canStop: false,
      };
      this.devices.set(event.serial, session);
      if (!this.selectedSerial) {
        this.selectedSerial = event.serial;
      }
    }
    session.state = event.state;
    if (event.profile) {
      session.profile = event.profile;
    }
    if (event.device) {
      session.device = event.device;
      session.connected = event.device.state !== 'offline';
    }
    if (typeof event.canStop === 'boolean') {
      session.canStop = event.canStop;
    } else if (event.state === STATES.RUNNING || event.state === STATES.STOPPING) {
      session.canStop = true;
    } else if (event.state === STATES.IDLE) {
      session.canStop = false;
    }
    this.render();

    if (event.state === STATES.RUNNING
        && event.previousState === STATES.STARTING) {
      this.showToast(`scrcpy iniciado para ${this.deviceName(session)}.`);
    }
    if (this.currentView === 'files') {
      this.updateFileDeviceOptions();
    }
  }

  onFpsUpdate(metrics) {
    if (!metrics || typeof metrics.serial !== 'string'
        || !Number.isFinite(metrics.fps) || metrics.fps < 0) {
      return;
    }
    const history = this.fpsHistory.get(metrics.serial) || [];
    history.push({ fps: metrics.fps, timestamp: metrics.timestamp || Date.now() });
    this.fpsHistory.set(metrics.serial, history.slice(-30));
    if (metrics.serial === this.selectedSerial) {
      this.renderFps();
    }
  }

  onRecordingChanged(recording) {
    if (!recording || typeof recording.serial !== 'string') {
      return;
    }
    const session = this.devices.get(recording.serial);
    if (!session) {
      return;
    }
    session.isRecording = Boolean(recording.isRecording);
    session.recordingPath = recording.path || session.recordingPath || null;
    if (recording.error) {
      session.isRecording = false;
      this.showToast(`A gravação falhou: ${recording.error}`);
      this.appendLog({
        serial: recording.serial,
        message: recording.error,
      }, 'error');
      this.showLogs(true);
    } else if (!recording.isRecording && recording.path
        && !this.recordingRequests.has(recording.serial)) {
      this.showToast(`Gravação salva em: ${recording.path}`, 'success');
    }
    this.render();
  }

  async toggleSelectedRecording() {
    const session = this.devices.get(this.selectedSerial);
    if (!session || this.recordingRequests.has(session.serial)) {
      return;
    }
    const canRecord = session.connected
      && (session.state === STATES.RUNNING
        || (session.state === STATES.IDLE && !session.canStop));
    if (!canRecord) {
      return;
    }

    this.recordingRequests.add(session.serial);
    session.recordingPending = true;
    this.render();
    try {
      const result = await window.scrcpy.toggleRecording(session.serial);
      if (!result.ok) {
        throw new Error(result.message || 'Não foi possível alternar a gravação.');
      }
      session.isRecording = Boolean(result.isRecording);
      session.recordingPath = result.path || session.recordingPath || null;
      if (result.isRecording) {
        this.showToast(`Gravação iniciada: ${result.path}`, 'success');
      } else {
        this.showToast(`Gravação salva em: ${result.path}`, 'success');
      }
    } catch (error) {
      this.showToast(`Falha na gravação: ${error.message}`);
      this.appendLog({
        serial: session.serial,
        message: error.message,
      }, 'error');
      this.showLogs(true);
    } finally {
      this.recordingRequests.delete(session.serial);
      session.recordingPending = false;
      this.render();
    }
  }

  async setTheme(theme) {
    try {
      const result = await window.scrcpy.setTheme(theme);
      if (!result.ok) {
        throw new Error(result.message || 'Não foi possível salvar o tema.');
      }
      this.applyTheme(result);
      this.showToast(`Tema ${THEME_NAMES[result.theme]} aplicado.`, 'success');
    } catch (error) {
      this.showToast(`Falha ao salvar o tema: ${error.message}`);
    }
  }

  applyTheme({ theme, color }) {
    const brightColors = {
      green: '#b6ff78',
      purple: '#c29fff',
      blue: '#82c4ff',
      orange: '#ffc17f',
    };
    document.documentElement.style.setProperty('--primary-color', color);
    document.documentElement.style.setProperty('--green', color);
    document.documentElement.style.setProperty(
      '--green-bright',
      brightColors[theme],
    );
    for (const button of this.settingsDialog.querySelectorAll('[data-theme]')) {
      button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
    }
    if (this.fpsChart) {
      this.updateChartColors(color);
    }
  }

  ensureFpsChart() {
    if (this.fpsChart) {
      return;
    }
    if (!window.Chart) {
      if (!this.chartUnavailableReported) {
        this.chartUnavailableReported = true;
        this.showToast('A biblioteca local do gráfico de FPS não foi carregada.');
      }
      return;
    }
    const color = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary-color').trim();
    this.fpsChart = new window.Chart(this.fpsCanvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: color,
          backgroundColor: `${color}26`,
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHitRadius: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              label: (context) => `${context.parsed.y} FPS`,
            },
          },
        },
        scales: {
          x: { display: false },
          y: {
            beginAtZero: true,
            suggestedMax: 60,
            grid: { color: 'rgb(130 144 157 / 12%)' },
            ticks: { color: '#82909d', maxTicksLimit: 4, font: { size: 9 } },
            border: { display: false },
          },
        },
      },
    });
  }

  updateChartColors(color) {
    const dataset = this.fpsChart.data.datasets[0];
    dataset.borderColor = color;
    dataset.backgroundColor = `${color}26`;
    this.fpsChart.update('none');
  }

  renderFps() {
    const history = this.fpsHistory.get(this.selectedSerial) || [];
    const latest = history.at(-1);
    this.fpsValue.textContent = latest ? String(Math.round(latest.fps)) : '—';
    this.ensureFpsChart();
    if (!this.fpsChart) {
      return;
    }
    this.fpsChart.data.labels = history.map((sample) =>
      new Date(sample.timestamp).toLocaleTimeString());
    this.fpsChart.data.datasets[0].data = history.map((sample) => sample.fps);
    this.fpsChart.update('none');
    this.fpsChart.resize();
  }

  async startSelectedDevice() {
    const session = this.devices.get(this.selectedSerial);
    if (!session || !this.canStart(session)) {
      return;
    }
    session.profile = this.profileSelect.value;
    session.state = STATES.STARTING;
    this.render();

    try {
      const result = await window.scrcpy.startDevice({
        serial: session.serial,
        device: session.device,
        profile: session.profile,
      });
      if (!result.ok) {
        session.state = result.state || STATES.ERROR;
        session.canStop = Boolean(result.canStop);
        this.render();
        this.showToast(result.message || 'Não foi possível iniciar o scrcpy.');
        this.appendLog({ serial: session.serial, message: result.message }, 'error');
        this.showLogs(true);
      }
    } catch (error) {
      session.state = STATES.ERROR;
      session.canStop = false;
      this.render();
      this.showToast(`Falha ao iniciar o scrcpy: ${error.message}`);
      this.appendLog({ serial: session.serial, message: error.message }, 'error');
      this.showLogs(true);
    }
  }

  async stopSelectedDevice() {
    const session = this.devices.get(this.selectedSerial);
    if (!session?.canStop) {
      return;
    }
    session.state = STATES.STOPPING;
    this.render();
    try {
      const result = await window.scrcpy.stopDevice(session.serial);
      session.state = result.state || STATES.IDLE;
      session.canStop = result.state === STATES.ERROR;
      this.render();
      if (!result.ok && result.message) {
        this.showToast(result.message);
      }
    } catch (error) {
      session.state = STATES.ERROR;
      this.render();
      this.showToast(`Falha ao parar o scrcpy: ${error.message}`);
    }
  }

  async removeDevice(serial) {
    const session = this.devices.get(serial);
    if (!session || session.canStop) {
      return;
    }
    try {
      await window.scrcpy.removeDevice(serial);
      this.devices.delete(serial);
      this.logs.delete(serial);
      if (this.selectedSerial === serial) {
        this.selectedSerial = this.devices.keys().next().value || null;
      }
      this.render();
    } catch (error) {
      this.showToast(`Não foi possível remover a aba: ${error.message}`);
    }
  }

  canStart(session) {
    return session.connected
      && ['device', undefined].includes(session.device?.state)
      && [STATES.IDLE, STATES.ERROR].includes(session.state)
      && !session.canStop;
  }

  render() {
    this.renderTabs();
    const session = this.devices.get(this.selectedSerial);
    const hasSession = Boolean(session);
    this.emptyState.hidden = hasSession;
    this.sessionContent.hidden = !hasSession;
    if (!session) {
      this.logDeviceLabel.textContent = 'saída do processo';
      this.transferStatus.hidden = true;
      this.fpsValue.textContent = '—';
      this.renderLogs();
      return;
    }

    this.sessionTitle.firstChild.textContent = `${this.deviceName(session)} `;
    this.statusLabel.textContent = STATE_LABELS[session.state] || STATE_LABELS[STATES.IDLE];
    this.statusLabel.classList.toggle('is-running', session.state === STATES.RUNNING);
    this.statusLabel.classList.toggle('is-error', session.state === STATES.ERROR);
    this.statusIcon.classList.toggle('is-running', session.state === STATES.RUNNING);
    this.statusIcon.classList.toggle('is-error', session.state === STATES.ERROR);

    let detail = ({
      [STATES.IDLE]: 'Pronto para iniciar a sessão.',
      [STATES.STARTING]: 'Abrindo o scrcpy e conectando ao Android...',
      [STATES.RUNNING]: 'Sessão scrcpy ativa.',
      [STATES.STOPPING]: 'Finalizando o processo do scrcpy...',
      [STATES.ERROR]: 'O scrcpy encontrou um erro. Consulte os logs.',
    })[session.state];
    if (!session.connected) {
      detail = 'Dispositivo desconectado. Reconecte-o para iniciar uma sessão.';
    } else if (session.device?.state && session.device.state !== 'device') {
      detail = `Dispositivo ADB ${this.describeDeviceState(session.device.state)}; autorize ou reconecte o Android.`;
    }
    this.statusDetail.textContent = detail;

    const starting = session.state === STATES.STARTING;
    const busy = starting || session.state === STATES.STOPPING;
    this.startButton.disabled = !this.canStart(session);
    this.startLabel.textContent = starting ? 'Iniciando...' : 'Iniciar Scrcpy';
    this.stopButton.disabled = !session.canStop || session.state === STATES.STOPPING;
    const canRecord = session.connected
      && (session.state === STATES.RUNNING
        || (session.state === STATES.IDLE && !session.canStop));
    this.recordButton.disabled = !canRecord || busy || Boolean(session.recordingPending);
    this.recordButton.classList.toggle('is-recording', Boolean(session.isRecording));
    this.recordButton.setAttribute('aria-pressed', String(Boolean(session.isRecording)));
    this.recordLabel.textContent = session.recordingPending
      ? 'Aguarde...'
      : session.isRecording ? 'Parar gravação' : 'Gravar';
    this.profileSelect.value = session.profile || 'default';
    this.profileSelect.disabled = busy || session.state === STATES.RUNNING;
    this.filePicker.disabled = Boolean(session.uploading);
    this.dropzone.classList.toggle('is-uploading', Boolean(session.uploading));
    this.logDeviceLabel.textContent = `scrcpy — ${this.deviceName(session)}`;
    this.renderFps();
    this.renderLogs();
    this.transferStatus.hidden = !session.transfer;
    if (session.transfer) {
      this.transferStatus.hidden = false;
      this.transferStatus.classList.toggle('is-error', Boolean(session.transfer.error));
      this.transferProgress.value = session.transfer.percent;
      this.transferPercent.textContent = `${session.transfer.percent}%`;
      this.transferLabel.textContent = session.transfer.error
        ? `Falha na transferência: ${session.transfer.message || 'consulte o alerta.'}`
        : session.transfer.complete
          ? 'Transferência concluída.'
          : `${session.transfer.operation === 'install' ? 'Instalando' : 'Enviando'} ${session.transfer.fileName} (${session.transfer.fileIndex}/${session.transfer.fileCount})`;
    }
    if (this.currentView === 'files') {
      this.updateFileDeviceOptions();
    }
  }

  renderTabs() {
    this.tabs.replaceChildren();
    for (const session of this.devices.values()) {
      const tab = document.createElement('div');
      tab.className = 'device-tab';
      tab.classList.toggle('is-selected', session.serial === this.selectedSerial);

      const select = document.createElement('button');
      select.className = 'device-tab-select';
      select.type = 'button';
      select.setAttribute('role', 'tab');
      select.setAttribute('aria-selected', String(session.serial === this.selectedSerial));
      select.addEventListener('click', () => {
        this.selectedSerial = session.serial;
        this.render();
      });
      const dot = document.createElement('span');
      dot.className = 'tab-status-dot';
      dot.classList.toggle('is-running', session.state === STATES.RUNNING);
      dot.classList.toggle('is-error', session.state === STATES.ERROR || !session.connected);
      const name = document.createElement('span');
      name.className = 'tab-device-name';
      name.textContent = this.deviceName(session);
      select.append(dot, name);

      const remove = document.createElement('button');
      remove.className = 'device-tab-remove';
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = `Remover ${this.deviceName(session)}`;
      remove.setAttribute('aria-label', remove.title);
      remove.disabled = session.canStop;
      remove.addEventListener('click', () => this.removeDevice(session.serial));
      tab.append(select, remove);
      this.tabs.append(tab);
    }
  }

  appendLog(log = {}, stream = 'stdout') {
    const serial = log.serial && this.devices.has(log.serial) ? log.serial : null;
    const key = serial || '__global__';
    const entries = this.logs.get(key) || [];
    for (const line of String(log.message || '').replace(/\r/g, '').split('\n')) {
      if (line) {
        entries.push({
          stream,
          timestamp: log.timestamp || new Date().toLocaleTimeString(),
          message: line,
        });
      }
    }
    this.logs.set(key, entries.slice(-1000));
    if (!serial || serial === this.selectedSerial) {
      if (stream === 'error') {
        this.showLogs(true);
      }
      this.renderLogs();
    }
  }

  renderLogs() {
    const entries = [
      ...(this.logs.get('__global__') || []),
      ...(this.selectedSerial ? this.logs.get(this.selectedSerial) || [] : []),
    ];
    this.logOutput.replaceChildren();
    for (const item of entries.slice(-1000)) {
      const row = document.createElement('div');
      row.className = `log-line log-${item.stream}`;
      const time = document.createElement('time');
      time.textContent = item.timestamp;
      const text = document.createElement('span');
      text.textContent = item.message;
      row.append(time, text);
      this.logOutput.append(row);
    }
    if (!this.logPanel.hidden) {
      this.logOutput.scrollTop = this.logOutput.scrollHeight;
    }
  }

  showLogs(show) {
    this.logPanel.hidden = !show;
    this.logsButton.setAttribute('aria-expanded', String(show));
    this.logsButton.textContent = show ? 'Ocultar logs' : 'Mostrar Logs';
    if (show) {
      this.renderLogs();
    }
  }

  showToast(message, type = 'error') {
    clearTimeout(this.toastHideTimeout);
    this.toastMessage.textContent = message;
    this.toast.classList.toggle('is-success', type === 'success');
    this.toast.classList.toggle('is-error', type !== 'success');
    this.toast.querySelector('.toast-icon').textContent =
      type === 'success' ? '✓' : '!';
    this.toast.hidden = false;
    requestAnimationFrame(() => this.toast.classList.add('is-visible'));
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => this.hideToast(), 6000);
  }

  hideToast() {
    clearTimeout(this.toastTimeout);
    this.toast.classList.remove('is-visible');
    clearTimeout(this.toastHideTimeout);
    this.toastHideTimeout = setTimeout(() => {
      this.toast.hidden = true;
    }, 200);
  }

  deviceName(session) {
    return session.device?.model || session.serial;
  }

  describeDeviceState(state) {
    return ({
      device: 'Pronto',
      offline: 'Offline',
      unauthorized: 'Autorize no celular',
      'no permissions': 'Sem permissões USB',
    })[state] || state || 'Estado desconhecido';
  }
}

(async function bootstrap() {
  let savedTheme;
  let themeError;
  try {
    savedTheme = await window.scrcpy.getTheme();
    if (!savedTheme || !THEME_NAMES[savedTheme.theme]
        || !/^#[\da-f]{6}$/i.test(savedTheme.color || '')) {
      throw new Error('O backend retornou uma preferência de tema inválida.');
    }
    document.documentElement.style.setProperty(
      '--primary-color',
      savedTheme.color,
    );
    document.documentElement.style.setProperty('--green', savedTheme.color);
  } catch (error) {
    themeError = error;
  }
  document.body.classList.remove('theme-loading');
  const commandCenter = new CommandCenter();
  if (savedTheme) {
    commandCenter.applyTheme(savedTheme);
  }
  if (themeError) {
    commandCenter.showToast(`Não foi possível carregar o tema salvo: ${themeError.message}`);
  }
})();
