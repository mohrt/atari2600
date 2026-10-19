import { Atari2600 } from '../../src/atari2600';
import { PlainCartridge } from '../../src/cart/schemes/plain';
import type { FrameInfo } from '../../src/tia/tia';
import { assemble } from './asm';

export interface TestMachine {
  machine: Atari2600;
  /** The most recent complete frame (colour indexes, 160 per line) and its info. */
  frame(): { pixels: Uint8Array; info: FrameInfo };
}

/** Wires the machine to keep a copy of each finished frame. */
export function watchFrames(machine: Atari2600): TestMachine['frame'] {
  let pixels = new Uint8Array(0);
  let info: FrameInfo = { lines: 0, firstVisible: -1, lastVisible: -1, synced: false };
  machine.tia.onFrame = (framePixels, frameInfo) => {
    pixels = framePixels.slice(0, frameInfo.lines * 160);
    info = frameInfo;
  };
  return () => ({ pixels, info });
}

/**
 * Assembles a 4K program at $F000 (reset vector to `Start`) and boots it.
 * The program should define a `Start:` label.
 */
export function bootProgram(source: string): TestMachine {
  const rom = assemble(`${source}\n.org $FFFC\n.word Start\n.word Start`);
  const machine = new Atari2600();
  const frame = watchFrames(machine);
  machine.insertCartridge(new PlainCartridge(rom));
  return { machine, frame };
}

/** A standard NTSC frame loop around a kernel; `kernel` runs once per visible line (Y = line). */
export function frameLoop(setup: string, kernel: string, lines = 192): string {
  return `
Start:
  sei
  cld
  ldx #$ff
  txs
  lda #0
Clear:
  sta $00,x
  dex
  bne Clear
${setup}
Frame:
  lda #2
  sta VSYNC
  sta WSYNC
  sta WSYNC
  sta WSYNC
  lda #0
  sta VSYNC
  ldx #37
VBlankLoop:
  sta WSYNC
  dex
  bne VBlankLoop
  lda #0
  sta VBLANK
  ldy #0
Kernel:
  sta WSYNC
${kernel}
  iny
  cpy #${lines}
  bne Kernel
  lda #2
  sta VBLANK
  ldx #${262 - 3 - 37 - lines}
Overscan:
  sta WSYNC
  dex
  bne Overscan
  jmp Frame
`;
}

/** The colour index of each pixel on one line of a frame. */
export function lineOf(pixels: Uint8Array, line: number): number[] {
  return [...pixels.subarray(line * 160, line * 160 + 160)];
}

/** Pixel x positions on a line whose colour index equals `color >> 1`. */
export function pixelsWithColor(pixels: Uint8Array, line: number, color: number): number[] {
  return lineOf(pixels, line).flatMap((value, x) => (value === color >> 1 ? [x] : []));
}
