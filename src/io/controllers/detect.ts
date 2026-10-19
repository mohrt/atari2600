import type { ControllerType } from './types';

/** Opcodes that read a zero-page address directly or indexed (LDA, LDX, LDY, BIT, LDA zp,X). */
const READ_OPCODES = new Set([0xa5, 0xa6, 0xa4, 0x24, 0xb5, 0xb4]);

/** Counts reads of TIA input registers (with their $30 mirrors). */
function countReads(rom: Uint8Array, registers: number[]): number {
  const addresses = new Set(registers.flatMap((reg) => [reg, reg | 0x30]));
  let count = 0;
  for (let i = 0; i < rom.length - 1; i++) {
    if (READ_OPCODES.has(rom[i]) && addresses.has(rom[i + 1])) count++;
  }
  return count;
}

function contains(rom: Uint8Array, pattern: number[]): boolean {
  outer: for (let i = 0; i <= rom.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) if (rom[i + j] !== pattern[j]) continue outer;
    return true;
  }
  return false;
}

/** LDA #value; STA zp/abs target. */
function storesImmediate(rom: Uint8Array, values: number[], target: number[]): boolean {
  return values.some((value) => contains(rom, [0xa9, value, ...target]));
}

const VBLANK = [0x85, 0x01];
const SWACNT = [0x8d, 0x81, 0x02];

/**
 * A guess at the controllers a game expects, from its code: paddle games
 * read the pot inputs (INPT0-3) after dumping them through VBLANK; keypad
 * games drive the keypad rows by making port A an output. Anything else is
 * taken for a joystick game. The player can always choose differently.
 */
export function guessControllers(rom: Uint8Array): [ControllerType, ControllerType] {
  const dumpsPots = storesImmediate(rom, [0x80, 0x82, 0xc0, 0xc2], VBLANK) || contains(rom, [0xa2, 0x82, 0x86, 0x01]);
  const drivesRows = storesImmediate(rom, [0xff, 0xf0, 0x0f], SWACNT);
  const left = countReads(rom, [0x08, 0x09]);
  const right = countReads(rom, [0x0a, 0x0b]);

  const guess = (reads: number): ControllerType => {
    if (reads === 0) return 'joystick';
    if (dumpsPots) return 'paddles';
    if (drivesRows) return 'keypad';
    return 'joystick';
  };
  return [guess(left), guess(right)];
}
