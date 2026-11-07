const { EventEmitter } = require('node:events');

const DEVICE_STATES = Object.freeze({
  IDLE: 'IDLE',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  ERROR: 'ERROR',
  STOPPING: 'STOPPING',
});

const TRANSITIONS = Object.freeze({
  [DEVICE_STATES.IDLE]: new Set([
    DEVICE_STATES.STARTING,
    DEVICE_STATES.ERROR,
  ]),
  [DEVICE_STATES.STARTING]: new Set([
    DEVICE_STATES.RUNNING,
    DEVICE_STATES.ERROR,
    DEVICE_STATES.STOPPING,
    DEVICE_STATES.IDLE,
  ]),
  [DEVICE_STATES.RUNNING]: new Set([
    DEVICE_STATES.ERROR,
    DEVICE_STATES.STOPPING,
    DEVICE_STATES.IDLE,
  ]),
  [DEVICE_STATES.ERROR]: new Set([
    DEVICE_STATES.STARTING,
    DEVICE_STATES.STOPPING,
    DEVICE_STATES.IDLE,
  ]),
  [DEVICE_STATES.STOPPING]: new Set([
    DEVICE_STATES.IDLE,
    DEVICE_STATES.ERROR,
  ]),
});

class DeviceStateMachine extends EventEmitter {
  constructor(serial) {
    super();
    if (typeof serial !== 'string' || !serial.trim()) {
      throw new TypeError('A device serial is required.');
    }

    this.serial = serial;
    this.state = DEVICE_STATES.IDLE;
  }

  canTransition(nextState) {
    return TRANSITIONS[this.state]?.has(nextState) ?? false;
  }

  transition(nextState, details = {}) {
    if (!Object.values(DEVICE_STATES).includes(nextState)) {
      throw new TypeError(`Unknown device state: ${nextState}`);
    }
    if (!this.canTransition(nextState)) {
      return false;
    }

    const previousState = this.state;
    this.state = nextState;
    this.emit('change', {
      serial: this.serial,
      previousState,
      state: nextState,
      ...details,
    });
    return true;
  }

  reset() {
    if (this.state === DEVICE_STATES.IDLE) {
      return true;
    }
    return this.transition(DEVICE_STATES.IDLE);
  }
}

module.exports = { DEVICE_STATES, DeviceStateMachine };
