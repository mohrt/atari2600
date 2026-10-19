import { describe, expect, it } from 'vitest';
import { bootProgram, frameLoop, lineOf, pixelsWithColor } from './helpers/machine';

/** Kernel line y appears on frame line FIRST_LINE + y in frameLoop programs. */
const FIRST_LINE = 40;
const P0_COLOR = 0x46;
const P1_COLOR = 0x86;
const PF_COLOR = 0xc8;
const BK_COLOR = 0x02;

function run(source: string, frames = 3) {
  const test = bootProgram(source);
  for (let i = 0; i < frames; i++) test.machine.runFrame();
  return test;
}

const colors = `
  lda #${P0_COLOR}
  sta COLUP0
  lda #${P1_COLOR}
  sta COLUP1
  lda #${PF_COLOR}
  sta COLUPF
  lda #${BK_COLOR}
  sta COLUBK
`;

/** On kernel line 0, waits `nops` NOPs after the line starts and strobes `register`. */
function resetOnFirstLine(register: string, nops: number): string {
  return `
  cpy #0
  bne Draw
${'  nop\n'.repeat(nops)}
  sta ${register}
Draw:
`;
}

describe('TIA frame timing', () => {
  it('produces 262-line frames from a standard NTSC kernel', () => {
    const { frame } = run(frameLoop(colors, ''));
    const { info } = frame();
    expect(info.lines).toBe(262);
    expect(info.synced).toBe(true);
    expect(info.firstVisible).toBe(FIRST_LINE - 1);
    // The last kernel line turns VBLANK back on before the beam reaches the picture.
    expect(info.lastVisible).toBe(FIRST_LINE + 190);
  });

  it('fills visible lines with the background colour and blanks the rest', () => {
    const { frame } = run(frameLoop(colors, ''));
    const { pixels } = frame();
    expect(new Set(lineOf(pixels, FIRST_LINE + 50))).toEqual(new Set([BK_COLOR >> 1]));
    expect(new Set(lineOf(pixels, 10))).toEqual(new Set([0]));
  });
});

describe('TIA playfield', () => {
  it('repeats the left half on the right', () => {
    const { frame } = run(frameLoop(`${colors}\n  lda #$10\n  sta PF0\n  lda #$80\n  sta PF2`, ''));
    const lit = pixelsWithColor(frame().pixels, FIRST_LINE + 10, PF_COLOR);
    expect(lit).toEqual([0, 1, 2, 3, 76, 77, 78, 79, 80, 81, 82, 83, 156, 157, 158, 159]);
  });

  it('mirrors the right half when CTRLPF bit 0 is set', () => {
    const { frame } = run(frameLoop(`${colors}\n  lda #1\n  sta CTRLPF\n  lda #$10\n  sta PF0`, ''));
    const lit = pixelsWithColor(frame().pixels, FIRST_LINE + 10, PF_COLOR);
    expect(lit).toEqual([0, 1, 2, 3, 156, 157, 158, 159]);
  });

  it('colours each half with the player colours in score mode', () => {
    const { frame } = run(frameLoop(`${colors}\n  lda #2\n  sta CTRLPF\n  lda #$ff\n  sta PF1`, ''));
    const { pixels } = frame();
    expect(pixelsWithColor(pixels, FIRST_LINE + 10, P0_COLOR)).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47]);
    expect(pixelsWithColor(pixels, FIRST_LINE + 10, P1_COLOR)[0]).toBe(96);
  });
});

describe('TIA object positioning', () => {
  it('puts a player 5 pixels after the beam when RESP0 is hit in the visible line', () => {
    // RESP0's write lands on CPU cycle 4 + 2 * 20 + 3 = 47, colour clock 141, pixel 73.
    const { frame } = run(frameLoop(`${colors}\n  lda #$80\n  sta GRP0`, resetOnFirstLine('RESP0', 20)));
    const { pixels } = frame();
    expect(pixelsWithColor(pixels, FIRST_LINE + 5, P0_COLOR)).toEqual([78]);
    // The first copy isn't drawn on the line the reset happens.
    expect(pixelsWithColor(pixels, FIRST_LINE, P0_COLOR)).toEqual([]);
  });

  it('puts a player at pixel 3 when RESP0 is hit during horizontal blank', () => {
    const { frame } = run(frameLoop(`${colors}\n  lda #$80\n  sta GRP0`, resetOnFirstLine('RESP0', 0)));
    expect(pixelsWithColor(frame().pixels, FIRST_LINE + 5, P0_COLOR)).toEqual([3]);
  });

  it('puts missiles and the ball 4 pixels after the beam', () => {
    const setup = `${colors}\n  lda #2\n  sta ENAM0\n  sta ENABL`;
    const missile = run(frameLoop(setup, resetOnFirstLine('RESM0', 20)));
    expect(pixelsWithColor(missile.frame().pixels, FIRST_LINE + 5, P0_COLOR)).toEqual([77]);
    const ball = run(frameLoop(setup.replace('sta ENAM0', 'nop'), resetOnFirstLine('RESBL', 20)));
    expect(pixelsWithColor(ball.frame().pixels, FIRST_LINE + 5, PF_COLOR)).toEqual([77]);
  });

  it('draws NUSIZ copies and double-width players', () => {
    const three = run(frameLoop(`${colors}\n  lda #$80\n  sta GRP0\n  lda #3\n  sta NUSIZ0`, resetOnFirstLine('RESP0', 10)));
    // Cycle 27, clock 81, pixel 13 + 5 = 18.
    expect(pixelsWithColor(three.frame().pixels, FIRST_LINE + 5, P0_COLOR)).toEqual([18, 34, 50]);
    const double = run(frameLoop(`${colors}\n  lda #$c0\n  sta GRP0\n  lda #5\n  sta NUSIZ0`, resetOnFirstLine('RESP0', 10)));
    expect(pixelsWithColor(double.frame().pixels, FIRST_LINE + 5, P0_COLOR)).toEqual([19, 20, 21, 22]);
  });

  it('reflects player graphics with REFP0', () => {
    const { frame } = run(frameLoop(`${colors}\n  lda #$c0\n  sta GRP0\n  lda #8\n  sta REFP0`, resetOnFirstLine('RESP0', 10)));
    expect(pixelsWithColor(frame().pixels, FIRST_LINE + 5, P0_COLOR)).toEqual([24, 25]);
  });
});

describe('TIA HMOVE', () => {
  const moveOnLine = (hm: number) => `
  cpy #0
  bne NotFirst
  nop
  nop
  nop
  nop
  nop
  nop
  nop
  nop
  nop
  nop
  sta RESP0
  jmp Done
NotFirst:
  cpy #2
  bne Done
  lda #${hm}
  sta HMP0
  sta WSYNC
  sta HMOVE
  iny
Done:
`;

  it('moves objects by their HM value and blanks the first 8 pixels of the line', () => {
    const left = run(frameLoop(`${colors}\n  lda #$80\n  sta GRP0`, moveOnLine(0x30)));
    const { pixels } = left.frame();
    expect(pixelsWithColor(pixels, FIRST_LINE + 1, P0_COLOR)).toEqual([18]);
    expect(pixelsWithColor(pixels, FIRST_LINE + 10, P0_COLOR)).toEqual([15]);
    // The HMOVE line starts with an 8-pixel black bar.
    expect(lineOf(pixels, FIRST_LINE + 3).slice(0, 9)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, BK_COLOR >> 1]);

    const right = run(frameLoop(`${colors}\n  lda #$80\n  sta GRP0`, moveOnLine(0xd0)));
    expect(pixelsWithColor(right.frame().pixels, FIRST_LINE + 10, P0_COLOR)).toEqual([21]);
  });
});

describe('TIA graphics registers and collisions', () => {
  it('delays GRP0 until GRP1 is written when VDELP0 is set', () => {
    const kernel = `
  cpy #20
  bne Draw
  lda #$80
  sta GRP0
Draw:
`;
    const setup = `${colors}\n  lda #1\n  sta VDELP0\n  sta WSYNC\n  sta RESP0`;
    const { frame } = run(frameLoop(setup, kernel));
    expect(pixelsWithColor(frame().pixels, FIRST_LINE + 30, P0_COLOR)).toEqual([]);
    const written = run(frameLoop(setup, kernel.replace('sta GRP0', 'sta GRP0\n  sta GRP1')));
    expect(pixelsWithColor(written.frame().pixels, FIRST_LINE + 30, P0_COLOR).length).toBe(1);
  });

  it('latches player-player collisions until CXCLR', () => {
    const setup = `${colors}\n  lda #$ff\n  sta GRP0\n  sta GRP1\n  sta WSYNC\n  sta RESP0\n  sta RESP1`;
    const overscanCheck = `
  cpy #191
  bne Draw
  lda CXPPMM
  sta $80
  sta CXCLR
Draw:
`;
    const { machine } = run(frameLoop(setup, overscanCheck));
    expect(machine.riot.ram[0] & 0x80).toBe(0x80);
    const apart = run(frameLoop(setup.replace('sta RESP1', 'nop\n  nop\n  nop\n  nop\n  nop\n  nop\n  nop\n  nop\n  nop\n  nop\n  sta RESP1'), overscanCheck));
    expect(apart.machine.riot.ram[0] & 0x80).toBe(0);
  });

  it('draws the playfield over players when CTRLPF priority is set', () => {
    const setup = `${colors}\n  lda #$ff\n  sta GRP0\n  sta PF0\n  sta PF1\n  sta PF2\n  lda #4\n  sta CTRLPF\n  sta WSYNC\n  sta RESP0`;
    const { frame } = run(frameLoop(setup, ''));
    expect(pixelsWithColor(frame().pixels, FIRST_LINE + 10, P0_COLOR)).toEqual([]);
  });
});

describe('TIA inputs', () => {
  it('reads fire buttons on INPT4/INPT5 and latches them when VBLANK bit 6 is set', () => {
    const { machine } = bootProgram('Start:\n  jmp Start');
    let pressed = false;
    machine.tia.inputs = { potChargeClocks: () => 0, firePressed: (i) => i === 0 && pressed };
    expect(machine.tia.read(0x0c, 0) & 0x80).toBe(0x80);
    pressed = true;
    expect(machine.tia.read(0x0c, 0) & 0x80).toBe(0);
    expect(machine.tia.read(0x0d, 0) & 0x80).toBe(0x80);
    pressed = false;
    machine.tia.write(0x01, 0x40);
    expect(machine.tia.read(0x0c, 0) & 0x80).toBe(0x80);
    pressed = true;
    machine.tia.inputsChanged();
    pressed = false;
    expect(machine.tia.read(0x0c, 0) & 0x80).toBe(0);
  });

  it('charges paddle pots after VBLANK stops dumping them', () => {
    const { machine } = bootProgram('Start:\n  jmp Start');
    machine.tia.inputs = { potChargeClocks: () => 228 * 10, firePressed: () => false };
    machine.tia.write(0x01, 0x80);
    expect(machine.tia.read(0x08, 0) & 0x80).toBe(0);
    machine.tia.write(0x01, 0x00);
    machine.runCycles(76 * 5);
    expect(machine.tia.read(0x08, 0) & 0x80).toBe(0);
    machine.runCycles(76 * 6);
    expect(machine.tia.read(0x08, 0) & 0x80).toBe(0x80);
  });
});
