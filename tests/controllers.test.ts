import { describe, expect, it } from 'vitest';
import { Atari2600 } from '../src/atari2600';
import { guessControllers } from '../src/io/controllers/detect';
import { ControllerPorts } from '../src/io/controllers/ports';
import { Dir } from '../src/io/controllers/types';
import { PlayerInput } from '../src/io/player-input';

const SWCHA = 0x280;
const SWACNT = 0x281;
const SWCHB = 0x282;

function setup() {
  const machine = new Atari2600();
  const ports = new ControllerPorts(machine);
  return { machine, ports };
}

describe('joysticks', () => {
  it('pull the direction lines low: player 1 on the high nibble, player 2 on the low', () => {
    const { machine, ports } = setup();
    expect(machine.riot.readIo(SWCHA)).toBe(0xff);
    ports.players[0].set('test', { dirs: Dir.Right | Dir.Up });
    expect(machine.riot.readIo(SWCHA)).toBe(0x6f);
    ports.players[1].set('test', { dirs: Dir.Left });
    expect(machine.riot.readIo(SWCHA)).toBe(0x6b);
  });

  it('read fire buttons on INPT4 (left) and INPT5 (right)', () => {
    const { machine, ports } = setup();
    ports.players[1].set('test', { fire: true });
    expect(machine.tia.read(0x0c, 0) & 0x80).toBe(0x80);
    expect(machine.tia.read(0x0d, 0) & 0x80).toBe(0);
  });
});

describe('PlayerInput', () => {
  it('combines sources like switches wired in parallel', () => {
    const player = new PlayerInput();
    player.set('keys', { dirs: Dir.Up });
    player.set('pad', { dirs: Dir.Left, fire: true });
    expect(player.dirs).toBe(Dir.Up | Dir.Left);
    expect(player.fire).toBe(true);
    player.clear('pad');
    expect(player.fire).toBe(false);
  });
});

describe('paddles', () => {
  it('charge sooner the further right they are turned', () => {
    const { ports } = setup();
    ports.setType(0, 'paddles');
    ports.players[0].set('test', { paddle: 0.25 });
    ports.players[1].set('test', { paddle: 0.75 });
    ports.update(16);
    expect(ports.potChargeClocks(0)).toBeGreaterThan(ports.potChargeClocks(1));
    expect(ports.potChargeClocks(2)).toBe(Infinity);
    ports.setType(1, 'paddles');
    expect(ports.potChargeClocks(2)).toBe((1 - 0.5) * 380 * 228);
  });

  it('turn with keys or a stick, and stop at the ends', () => {
    const { ports } = setup();
    ports.setType(0, 'paddles');
    ports.players[0].set('test', { dirs: Dir.Right });
    ports.update(275);
    expect(ports.paddles[0]).toBeCloseTo(0.75, 2);
    ports.update(1000);
    expect(ports.paddles[0]).toBe(1);
    ports.players[0].set('test', { analogX: -0.5 });
    ports.update(550);
    expect(ports.paddles[0]).toBeCloseTo(0.75, 2);
  });

  it('follow relative mouse movement', () => {
    const { ports } = setup();
    ports.setType(0, 'paddles');
    ports.players[0].addPaddleDelta(-0.2);
    ports.update(16);
    expect(ports.paddles[0]).toBeCloseTo(0.3);
  });

  it('put the paddle buttons on the joystick lines', () => {
    const { machine, ports } = setup();
    ports.setType(0, 'paddles');
    ports.players[0].set('test', { fire: true });
    expect(machine.riot.readIo(SWCHA)).toBe(0x7f);
    ports.players[1].set('test', { fire: true });
    expect(machine.riot.readIo(SWCHA)).toBe(0x3f);
    expect(machine.tia.read(0x0c, 0) & 0x80).toBe(0x80);
  });

  it('read through the TIA after VBLANK releases the dump', () => {
    const { machine, ports } = setup();
    ports.setType(0, 'paddles');
    ports.players[0].set('test', { paddle: 1 - 20 / 380 }); // charges in 20 lines
    ports.update(0);
    machine.tia.write(0x01, 0x80);
    machine.tia.write(0x01, 0x00);
    machine.tia.colorClocks += 19 * 228;
    expect(machine.tia.read(0x08, 0) & 0x80).toBe(0);
    machine.tia.colorClocks += 2 * 228;
    expect(machine.tia.read(0x08, 0) & 0x80).toBe(0x80);
  });
});

describe('driving controllers', () => {
  it('step through the Gray code as they turn', () => {
    const { machine, ports } = setup();
    ports.setType(0, 'driving');
    const codes: number[] = [];
    ports.players[0].set('test', { dirs: Dir.Right });
    for (let i = 0; i < 5; i++) {
      codes.push((machine.riot.readIo(SWCHA) >> 4) & 0x03);
      ports.update(25);
    }
    expect(codes).toEqual([0b00, 0b01, 0b11, 0b10, 0b00]);
  });
});

describe('keypads', () => {
  it('pull a column low when a key in a driven row is held', () => {
    const { machine, ports } = setup();
    ports.setType(0, 'keypad');
    machine.riot.writeIo(SWACNT, 0xff);
    ports.players[0].set('test', { keypad: 1 << 4 }); // key 5: row 1, column 1
    machine.riot.writeIo(SWCHA, 0xef); // row 0 low
    expect(machine.tia.read(0x09, 0) & 0x80).toBe(0x80);
    machine.riot.writeIo(SWCHA, 0xdf); // row 1 low
    expect(machine.tia.read(0x09, 0) & 0x80).toBe(0);
    expect(machine.tia.read(0x08, 0) & 0x80).toBe(0x80);
    ports.players[0].set('test', { keypad: 1 << 5 }); // key 6: column 2, read on INPT4
    expect(machine.tia.read(0x0c, 0) & 0x80).toBe(0);
  });
});

describe('console switches', () => {
  it('are read on SWCHB', () => {
    const { machine, ports } = setup();
    expect(machine.riot.readIo(SWCHB)).toBe(0x3f);
    ports.switches.leftDifficultyA = true;
    ports.switches.color = false;
    ports.switches.buttons.set('test', true, false);
    expect(machine.riot.readIo(SWCHB)).toBe(0x76);
  });
});

describe('controller guessing', () => {
  it('spots paddle games by their pot reads and VBLANK dumps', () => {
    const rom = new Uint8Array(4096);
    rom.set([0xa9, 0x82, 0x85, 0x01], 100); // LDA #$82; STA VBLANK
    rom.set([0x24, 0x08, 0x30, 0x02], 200); // BIT INPT0; BMI
    expect(guessControllers(rom)).toEqual(['paddles', 'joystick']);
  });

  it('spots keypad games by their row outputs', () => {
    const rom = new Uint8Array(4096);
    rom.set([0xa9, 0xf0, 0x8d, 0x81, 0x02], 100); // LDA #$F0; STA SWACNT
    rom.set([0xa5, 0x0a], 200); // LDA INPT2
    expect(guessControllers(rom)).toEqual(['joystick', 'keypad']);
  });

  it('assumes joysticks otherwise', () => {
    expect(guessControllers(new Uint8Array(4096))).toEqual(['joystick', 'joystick']);
  });
});
