import type { Atari2600 } from '../../atari2600';
import type { TiaInputs } from '../../tia/tia';
import { CLOCKS_PER_LINE } from '../../tia/tia';
import { ConsoleButtons, PlayerInput } from '../player-input';
import { Dir, type ControllerType } from './types';

/** A paddle's capacitor charges in up to this many scanlines (1 MΩ pot, 68 nF capacitor). */
const PADDLE_MAX_LINES = 380;
/** Full-speed turning (keys or a full stick) sweeps the whole paddle range in this long. */
const PADDLE_SWEEP_MS = 1100;
/** Driving controller steps per second when turned at full speed. */
const DRIVING_STEPS_PER_SECOND = 40;
/** The driving controller's two switches step through this Gray code as it turns. */
const GRAY_CODE = [0b00, 0b01, 0b11, 0b10];

/** Console switch state: the toggles stay put; Reset and Select are held by their buttons. */
export class ConsoleSwitches {
  color = true;
  /** Difficulty A ("pro") when true, B ("amateur") when false. */
  leftDifficultyA = false;
  rightDifficultyA = false;
  readonly buttons = new ConsoleButtons();

  /** SWCHB as the console wires it (a switch closed = 0). */
  get pins(): number {
    let value = 0xff;
    if (this.buttons.reset) value &= ~0x01;
    if (this.buttons.select) value &= ~0x02;
    if (!this.color) value &= ~0x08;
    if (!this.leftDifficultyA) value &= ~0x40;
    if (!this.rightDifficultyA) value &= ~0x80;
    return value;
  }
}

/**
 * The two controller ports. Each takes a joystick, a pair of paddles, a
 * driving controller or a keypad, driven by players 1-4:
 * joysticks, driving controllers and keypads are player 1 (left port) and
 * player 2 (right port); paddles come in pairs, so players 1 and 2 have the
 * left port's paddles and players 3 and 4 the right port's.
 */
export class ControllerPorts implements TiaInputs {
  readonly players = [new PlayerInput(), new PlayerInput(), new PlayerInput(), new PlayerInput()];
  readonly switches = new ConsoleSwitches();
  readonly types: [ControllerType, ControllerType] = ['joystick', 'joystick'];
  /** Paddle positions from 0 (fully left) to 1 (fully right): left A, left B, right A, right B. */
  readonly paddles = [0.5, 0.5, 0.5, 0.5];
  /** Driving controller rotation (fractional steps) for each port. */
  readonly driving = [0, 0];

  constructor(private readonly machine: Atari2600) {
    machine.tia.inputs = this;
    machine.riot.portAPins = () => (this.portNibble(0) << 4) | this.portNibble(1);
    machine.riot.portBPins = () => this.switches.pins;
  }

  setType(port: 0 | 1, type: ControllerType): void {
    this.types[port] = type;
    this.inputsChanged();
  }

  /** Moves paddles and driving controllers by `elapsedMs` of turning, then updates latches. */
  update(elapsedMs: number): void {
    for (let port = 0; port < 2; port++) {
      if (this.types[port] === 'paddles') {
        this.updatePaddle(port * 2, elapsedMs);
        this.updatePaddle(port * 2 + 1, elapsedMs);
      } else {
        this.players[port * 2].takePaddleDelta();
        this.players[port * 2 + 1].takePaddleDelta();
      }
      if (this.types[port] === 'driving') {
        const player = this.players[port];
        this.driving[port] += this.turnRate(player) * DRIVING_STEPS_PER_SECOND * (elapsedMs / 1000);
      }
    }
    this.inputsChanged();
  }

  private inputsChanged(): void {
    this.machine.tia.inputsChanged();
    this.machine.riot.checkPa7();
  }

  /** -1..1: how fast a player is turning, from a stick or (at full speed) the left/right directions. */
  private turnRate(player: PlayerInput): number {
    const dirs = player.dirs;
    const digital = (dirs & Dir.Right ? 1 : 0) - (dirs & Dir.Left ? 1 : 0);
    return digital !== 0 ? digital : player.analogX;
  }

  private updatePaddle(index: number, elapsedMs: number): void {
    const player = this.players[index];
    const absolute = player.absolutePaddle;
    const delta = player.takePaddleDelta();
    let position = this.paddles[index];
    if (absolute !== null) position = absolute;
    else position += delta + (this.turnRate(player) * elapsedMs) / PADDLE_SWEEP_MS;
    this.paddles[index] = Math.min(1, Math.max(0, position));
  }

  /** The four direction lines of a port (bit 0 up ... bit 3 right; 1 = released). */
  private portNibble(port: number): number {
    switch (this.types[port]) {
      case 'joystick':
        return ~this.players[port].dirs & 0x0f;
      case 'paddles': {
        // Paddle A's button is on the "right" line, paddle B's on "left".
        const a = this.players[port * 2].fire;
        const b = this.players[port * 2 + 1].fire;
        return 0x0f & ~((a ? 0x08 : 0) | (b ? 0x04 : 0));
      }
      case 'driving':
        return 0x0c | GRAY_CODE[Math.floor(this.driving[port]) & 3];
      case 'keypad':
        return 0x0f;
    }
  }

  /** Whether a keypad column reads low: one of its keys is held and its row is driven low. */
  private keypadColumnLow(port: number, column: number): boolean {
    const riot = this.machine.riot;
    const driven = riot.ddrA & ~riot.outA;
    const keys = this.players[port].keypad;
    for (let row = 0; row < 4; row++) {
      const rowBit = port === 0 ? 0x10 << row : 0x01 << row;
      if (driven & rowBit && keys & (1 << (row * 3 + column))) return true;
    }
    return false;
  }

  potChargeClocks(index: number): number {
    const port = index >> 1;
    switch (this.types[port]) {
      case 'paddles':
        // Turning right lowers the resistance, so the capacitor charges sooner.
        return (1 - this.paddles[index]) * PADDLE_MAX_LINES * CLOCKS_PER_LINE;
      case 'keypad':
        return this.keypadColumnLow(port, index & 1) ? Infinity : 0;
      default:
        return Infinity;
    }
  }

  firePressed(index: number): boolean {
    switch (this.types[index]) {
      case 'joystick':
      case 'driving':
        return this.players[index].fire;
      case 'keypad':
        return this.keypadColumnLow(index, 2);
      default:
        return false;
    }
  }
}
