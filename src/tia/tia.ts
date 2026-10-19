import { TiaAudio } from './audio';
import {
  BALL_PIXELS,
  BL,
  COLLISIONS,
  COUNTER_RANGE,
  M0,
  M1,
  MAIN_COPY,
  MISSILE_PIXELS,
  P0,
  P1,
  PF,
  PLAYER_PIXELS,
  RESMP_OFFSET,
  REVERSED,
} from './objects';

export const CLOCKS_PER_LINE = 228;
export const HBLANK_CLOCKS = 68;
/** HMOVE extends the horizontal blank by 8 clocks (the "HMOVE bar"). */
const HMOVE_BLANK_END = HBLANK_CLOCKS + 8;
export const VISIBLE_WIDTH = 160;
/** A frame is cut off here if the game never sends VSYNC. */
export const MAX_FRAME_LINES = 400;

/** RESPx/RESMx/RESBL put the object this many pixels after the beam (or here, in HBLANK). */
const PLAYER_RESET_DELAY = 5;
const PLAYER_HBLANK_POSITION = 3;
const MISSILE_RESET_DELAY = 4;
const MISSILE_HBLANK_POSITION = 2;

/** HMOVE's ripple counter takes its first step this many clocks after the strobe, then one per 4. */
const HMOVE_FIRST_STEP = 6;
const HMOVE_STEP_CLOCKS = 4;

/** Clocks before a register write takes effect (playfield, graphics and enable registers lag). */
const WRITE_DELAY = new Uint8Array(64);
WRITE_DELAY[0x0d] = WRITE_DELAY[0x0e] = WRITE_DELAY[0x0f] = 2;
WRITE_DELAY[0x1b] = WRITE_DELAY[0x1c] = 1;
WRITE_DELAY[0x1d] = WRITE_DELAY[0x1e] = WRITE_DELAY[0x1f] = 1;
const MAX_PENDING = 16;

// Slots in Tia.colorIndex.
const COLOR_P0 = 0;
const COLOR_P1 = 1;
const COLOR_PF = 2;
const COLOR_BK = 3;

/** What the controllers present to the TIA's input pins. */
export interface TiaInputs {
  /**
   * Colour clocks pot line 0-3 (INPT0-3) takes to read high after VBLANK
   * stops dumping it: 0 for at once, Infinity for never.
   */
  potChargeClocks(index: number): number;
  /** Whether input line 0 (INPT4) or 1 (INPT5) is pulled low, e.g. by a fire button. */
  firePressed(index: number): boolean;
}

const noInputs: TiaInputs = { potChargeClocks: () => Infinity, firePressed: () => false };

export interface FrameInfo {
  /** Lines in this frame (from one VSYNC to the next). */
  lines: number;
  /** First and last lines with VBLANK off (-1 if VBLANK stayed on). */
  firstVisible: number;
  lastVisible: number;
  /** False if the frame was cut off without a VSYNC. */
  synced: boolean;
}

/**
 * The TIA: draws the picture one colour clock at a time (3 per CPU cycle),
 * makes the sound, and reads the paddle and fire button inputs. Pixels are
 * written as 7-bit colour indexes (the colour register value >> 1).
 */
export class Tia {
  readonly audio = new TiaAudio();
  inputs: TiaInputs = noInputs;
  onFrame: (pixels: Uint8Array, info: FrameInfo) => void = () => {};

  hclock = 0;
  line = 0;
  colorClocks = 0;
  frameCount = 0;
  /** Set by WSYNC; the machine halts the CPU until the next line starts. */
  wsync = false;
  frameStartPending = false;
  firstVisible = -1;
  lastVisible = -1;
  lineHasPicture = false;

  private readonly framebuffers = [new Uint8Array(VISIBLE_WIDTH * MAX_FRAME_LINES), new Uint8Array(VISIBLE_WIDTH * MAX_FRAME_LINES)];
  private framebufferIndex = 0;
  private framebuffer = this.framebuffers[0];
  private lineOffset = 0;

  // Registers
  vsync = 0;
  vblank = 0;
  nusiz0 = 0;
  nusiz1 = 0;
  colup0 = 0;
  colup1 = 0;
  colupf = 0;
  colubk = 0;
  ctrlpf = 0;
  refp0 = 0;
  refp1 = 0;
  pf0 = 0;
  pf1 = 0;
  pf2 = 0;
  grp0 = 0;
  grp0Old = 0;
  grp1 = 0;
  grp1Old = 0;
  enam0 = 0;
  enam1 = 0;
  enabl = 0;
  enablOld = 0;
  vdelp0 = 0;
  vdelp1 = 0;
  vdelbl = 0;
  resmp0 = 0;
  resmp1 = 0;
  /** HMP0, HMP1, HMM0, HMM1, HMBL as 4-bit values (the register's high nibble). */
  readonly hm = new Uint8Array(5);

  // Derived drawing state
  p0Gfx = 0;
  p1Gfx = 0;
  m0On = false;
  m1On = false;
  blOn = false;
  p0Base = 0;
  p1Base = 0;
  m0Base = 0;
  m1Base = 0;
  blBase = 0;
  readonly pfCells = new Uint8Array(40);
  pfBit = 0;

  // Object position counters
  p0c = 0;
  p1c = 0;
  m0c = 0;
  m1c = 0;
  blc = 0;
  /** Objects reset on this line, whose first copy isn't drawn until the next. */
  skipMain = 0;

  // HMOVE
  hmoveBlank = false;
  hmoveActive = false;
  hmoveTimer = 0;
  hmoveStep = 0;
  moving = 0;

  collisions = 0;

  // Inputs
  dumpReleasedAt = 0;
  latch0 = true;
  latch1 = true;

  readonly pendingReg = new Uint8Array(MAX_PENDING);
  readonly pendingValue = new Uint8Array(MAX_PENDING);
  readonly pendingDelay = new Uint8Array(MAX_PENDING);
  pendingCount = 0;

  reset(): void {
    for (let reg = 0; reg <= 0x2c; reg++) {
      if (reg !== 0x02 && reg !== 0x03 && reg !== 0x2a && (reg < 0x10 || reg > 0x14)) this.apply(reg, 0);
    }
    this.vsync = this.vblank = 0;
    this.grp0Old = this.grp1Old = this.enablOld = 0;
    this.updateGraphics();
    this.p0c = this.p1c = this.m0c = this.m1c = this.blc = 0;
    this.skipMain = this.moving = this.hmoveStep = this.hmoveTimer = 0;
    this.hmoveActive = this.hmoveBlank = false;
    this.collisions = 0;
    this.wsync = false;
    this.latch0 = this.latch1 = true;
    this.dumpReleasedAt = this.colorClocks;
    this.pendingCount = 0;
    this.audio.reset();
  }

  /** Advances one CPU cycle (three colour clocks). */
  clock3(): void {
    this.clock();
    this.clock();
    this.clock();
  }

  private clock(): void {
    if (this.pendingCount) this.applyPending();
    const h = this.hclock;
    const blank = h < HBLANK_CLOCKS || (this.hmoveBlank && h < HMOVE_BLANK_END);
    if (!blank) {
      if (++this.p0c === COUNTER_RANGE) this.p0c = 0;
      if (++this.p1c === COUNTER_RANGE) this.p1c = 0;
      if (++this.m0c === COUNTER_RANGE) this.m0c = 0;
      if (++this.m1c === COUNTER_RANGE) this.m1c = 0;
      if (++this.blc === COUNTER_RANGE) this.blc = 0;
      this.drawPixel(h - HBLANK_CLOCKS);
    } else if (h >= HBLANK_CLOCKS) {
      this.framebuffer[this.lineOffset + h - HBLANK_CLOCKS] = 0;
    }
    if (this.hmoveActive && --this.hmoveTimer === 0) this.hmoveTick(blank);
    this.colorClocks++;
    if (++this.hclock === CLOCKS_PER_LINE) this.endLine();
    else if (this.hclock === CLOCKS_PER_LINE / 2) this.audio.clock();
  }

  private drawPixel(x: number): void {
    if (this.resmp0) this.m0c = (this.p0c - RESMP_OFFSET[this.nusiz0 & 7] + COUNTER_RANGE) % COUNTER_RANGE;
    if (this.resmp1) this.m1c = (this.p1c - RESMP_OFFSET[this.nusiz1 & 7] + COUNTER_RANGE) % COUNTER_RANGE;
    if ((x & 3) === 0) this.pfBit = this.pfCells[x >> 2];

    let mask = this.pfBit ? PF : 0;
    const skip = this.skipMain;
    if (this.p0Gfx) {
      const v = PLAYER_PIXELS[this.p0Base + this.p0c];
      if (v >= 0 && !((v & MAIN_COPY) && (skip & P0)) && (this.p0Gfx << (v & 7)) & 0x80) mask |= P0;
    }
    if (this.p1Gfx) {
      const v = PLAYER_PIXELS[this.p1Base + this.p1c];
      if (v >= 0 && !((v & MAIN_COPY) && (skip & P1)) && (this.p1Gfx << (v & 7)) & 0x80) mask |= P1;
    }
    if (this.m0On) {
      const v = MISSILE_PIXELS[this.m0Base + this.m0c];
      if (v && !((v & MAIN_COPY) && (skip & M0))) mask |= M0;
    }
    if (this.m1On) {
      const v = MISSILE_PIXELS[this.m1Base + this.m1c];
      if (v && !((v & MAIN_COPY) && (skip & M1))) mask |= M1;
    }
    if (this.blOn && BALL_PIXELS[this.blBase + this.blc] && !(skip & BL)) mask |= BL;
    if (mask) this.collisions |= COLLISIONS[mask];

    if (this.vblank & 0x02) {
      this.framebuffer[this.lineOffset + x] = 0;
    } else {
      this.lineHasPicture = true;
      const owner = (x < VISIBLE_WIDTH / 2 ? this.ownerLeft : this.ownerRight)[mask];
      this.framebuffer[this.lineOffset + x] = this.colorIndex[owner];
    }
  }

  /** COLUP0, COLUP1, COLUPF and COLUBK as colour indexes (value >> 1). */
  readonly colorIndex = new Uint8Array(4);
  /** Which colour register shows for each object combination (priority and score mode applied), per half line. */
  readonly ownerLeft = new Uint8Array(64);
  readonly ownerRight = new Uint8Array(64);

  private updateOwners(): void {
    const priority = (this.ctrlpf & 0x04) !== 0;
    const score = (this.ctrlpf & 0x02) !== 0 && !priority;
    for (let mask = 0; mask < 64; mask++) {
      let left: number;
      let right: number;
      if (priority && mask & (PF | BL)) left = right = COLOR_PF;
      else if (mask & (P0 | M0)) left = right = COLOR_P0;
      else if (mask & (P1 | M1)) left = right = COLOR_P1;
      else if (mask & BL) left = right = COLOR_PF;
      else if (mask & PF) [left, right] = score ? [COLOR_P0, COLOR_P1] : [COLOR_PF, COLOR_PF];
      else left = right = COLOR_BK;
      this.ownerLeft[mask] = left;
      this.ownerRight[mask] = right;
    }
  }

  /** One step of the HMOVE ripple counter: objects still moving get an extra clock while blanked. */
  private hmoveTick(blank: boolean): void {
    const step = this.hmoveStep;
    for (let i = 0; i < 5; i++) {
      const bit = 1 << i;
      if (!(this.moving & bit)) continue;
      if (step >= (this.hm[i] ^ 8)) {
        this.moving &= ~bit;
      } else if (blank) {
        this.bumpCounter(i);
      }
    }
    this.hmoveTimer = HMOVE_STEP_CLOCKS;
    if (++this.hmoveStep === 16 || this.moving === 0) this.hmoveActive = false;
  }

  private bumpCounter(object: number): void {
    switch (object) {
      case 0: this.p0c = (this.p0c + 1) % COUNTER_RANGE; break;
      case 1: this.p1c = (this.p1c + 1) % COUNTER_RANGE; break;
      case 2: this.m0c = (this.m0c + 1) % COUNTER_RANGE; break;
      case 3: this.m1c = (this.m1c + 1) % COUNTER_RANGE; break;
      default: this.blc = (this.blc + 1) % COUNTER_RANGE;
    }
  }

  private endLine(): void {
    this.hclock = 0;
    this.wsync = false;
    this.hmoveBlank = false;
    this.skipMain = 0;
    if (this.lineHasPicture) {
      if (this.firstVisible < 0) this.firstVisible = this.line;
      this.lastVisible = this.line;
      this.lineHasPicture = false;
    }
    this.line++;
    if (this.frameStartPending || this.line >= MAX_FRAME_LINES) this.emitFrame();
    this.lineOffset = this.line * VISIBLE_WIDTH;
    this.audio.clock();
  }

  private emitFrame(): void {
    const info: FrameInfo = {
      lines: this.line,
      firstVisible: this.firstVisible,
      lastVisible: this.lastVisible,
      synced: this.frameStartPending,
    };
    const pixels = this.framebuffer;
    this.framebufferIndex ^= 1;
    this.framebuffer = this.framebuffers[this.framebufferIndex];
    this.line = 0;
    this.firstVisible = this.lastVisible = -1;
    this.frameStartPending = false;
    this.frameCount++;
    this.onFrame(pixels, info);
  }

  // --- Register access ---------------------------------------------------------

  /** Reads a TIA register; the undriven low six bits keep whatever was last on the data bus. */
  read(addr: number, dataBus: number): number {
    const reg = addr & 0x0f;
    let value = 0;
    if (reg < 8) {
      const bits = this.collisions >> (reg * 2);
      value = ((bits & 1) << 7) | ((bits & 2) << 5);
    } else if (reg < 12) {
      value = this.potBit(reg - 8);
    } else if (reg < 14) {
      value = this.fireBit(reg - 12);
    }
    return value | (dataBus & 0x3f);
  }

  write(addr: number, value: number): void {
    const reg = addr & 0x3f;
    const delay = WRITE_DELAY[reg];
    if (delay === 0 || this.pendingCount === MAX_PENDING) {
      this.apply(reg, value);
      return;
    }
    const slot = this.pendingCount++;
    this.pendingReg[slot] = reg;
    this.pendingValue[slot] = value;
    this.pendingDelay[slot] = delay;
  }

  private applyPending(): void {
    let kept = 0;
    for (let i = 0; i < this.pendingCount; i++) {
      if (--this.pendingDelay[i] === 0) {
        this.apply(this.pendingReg[i], this.pendingValue[i]);
      } else {
        this.pendingReg[kept] = this.pendingReg[i];
        this.pendingValue[kept] = this.pendingValue[i];
        this.pendingDelay[kept] = this.pendingDelay[i];
        kept++;
      }
    }
    this.pendingCount = kept;
  }

  private apply(reg: number, value: number): void {
    switch (reg) {
      case 0x00:
        if (value & 0x02 && !(this.vsync & 0x02)) this.frameStartPending = true;
        this.vsync = value;
        break;
      case 0x01:
        if (this.vblank & 0x80 && !(value & 0x80)) this.dumpReleasedAt = this.colorClocks;
        if (value & 0x40 && !(this.vblank & 0x40)) this.latch0 = this.latch1 = true;
        this.vblank = value;
        this.inputsChanged();
        break;
      case 0x02:
        this.wsync = true;
        break;
      case 0x03:
        // RSYNC: the line ends three clocks from now.
        this.hclock = CLOCKS_PER_LINE - 3;
        break;
      case 0x04:
        this.nusiz0 = value;
        this.p0Base = (value & 7) * COUNTER_RANGE;
        this.m0Base = ((value & 7) * 4 + ((value >> 4) & 3)) * COUNTER_RANGE;
        break;
      case 0x05:
        this.nusiz1 = value;
        this.p1Base = (value & 7) * COUNTER_RANGE;
        this.m1Base = ((value & 7) * 4 + ((value >> 4) & 3)) * COUNTER_RANGE;
        break;
      case 0x06: this.colup0 = value & 0xfe; this.colorIndex[COLOR_P0] = value >> 1; break;
      case 0x07: this.colup1 = value & 0xfe; this.colorIndex[COLOR_P1] = value >> 1; break;
      case 0x08: this.colupf = value & 0xfe; this.colorIndex[COLOR_PF] = value >> 1; break;
      case 0x09: this.colubk = value & 0xfe; this.colorIndex[COLOR_BK] = value >> 1; break;
      case 0x0a:
        this.ctrlpf = value;
        this.blBase = ((value >> 4) & 3) * COUNTER_RANGE;
        this.updatePlayfield();
        this.updateOwners();
        break;
      case 0x0b: this.refp0 = value & 0x08; this.updateGraphics(); break;
      case 0x0c: this.refp1 = value & 0x08; this.updateGraphics(); break;
      case 0x0d: this.pf0 = value; this.updatePlayfield(); break;
      case 0x0e: this.pf1 = value; this.updatePlayfield(); break;
      case 0x0f: this.pf2 = value; this.updatePlayfield(); break;
      case 0x10:
        this.p0c = this.resetCounter(PLAYER_RESET_DELAY, PLAYER_HBLANK_POSITION);
        this.skipMain |= P0;
        break;
      case 0x11:
        this.p1c = this.resetCounter(PLAYER_RESET_DELAY, PLAYER_HBLANK_POSITION);
        this.skipMain |= P1;
        break;
      case 0x12:
        this.m0c = this.resetCounter(MISSILE_RESET_DELAY, MISSILE_HBLANK_POSITION);
        this.skipMain |= M0;
        break;
      case 0x13:
        this.m1c = this.resetCounter(MISSILE_RESET_DELAY, MISSILE_HBLANK_POSITION);
        this.skipMain |= M1;
        break;
      case 0x14:
        this.blc = this.resetCounter(MISSILE_RESET_DELAY, MISSILE_HBLANK_POSITION);
        this.skipMain |= BL;
        break;
      case 0x15: case 0x16: case 0x17: case 0x18: case 0x19: case 0x1a:
        this.audio.write(reg - 0x15, value);
        break;
      case 0x1b:
        this.grp0 = value;
        this.grp1Old = this.grp1;
        this.updateGraphics();
        break;
      case 0x1c:
        this.grp1 = value;
        this.grp0Old = this.grp0;
        this.enablOld = this.enabl;
        this.updateGraphics();
        break;
      case 0x1d: this.enam0 = value & 0x02; this.updateGraphics(); break;
      case 0x1e: this.enam1 = value & 0x02; this.updateGraphics(); break;
      case 0x1f: this.enabl = value & 0x02; this.updateGraphics(); break;
      case 0x20: case 0x21: case 0x22: case 0x23: case 0x24:
        this.hm[reg - 0x20] = value >> 4;
        break;
      case 0x25: this.vdelp0 = value & 0x01; this.updateGraphics(); break;
      case 0x26: this.vdelp1 = value & 0x01; this.updateGraphics(); break;
      case 0x27: this.vdelbl = value & 0x01; this.updateGraphics(); break;
      case 0x28: this.resmp0 = value & 0x02; this.updateGraphics(); break;
      case 0x29: this.resmp1 = value & 0x02; this.updateGraphics(); break;
      case 0x2a:
        this.hmoveActive = true;
        this.hmoveStep = 0;
        this.hmoveTimer = HMOVE_FIRST_STEP;
        this.moving = 0x1f;
        if (this.hclock < HBLANK_CLOCKS) this.hmoveBlank = true;
        break;
      case 0x2b:
        this.hm.fill(0);
        break;
      case 0x2c:
        this.collisions = 0;
        break;
    }
  }

  /** The counter value after a reset strobe, so the object's first pixel lands at the right place. */
  private resetCounter(delay: number, hblankPosition: number): number {
    const h = this.hclock;
    const blank = h < HBLANK_CLOCKS || (this.hmoveBlank && h < HMOVE_BLANK_END);
    return COUNTER_RANGE - 1 - (blank ? hblankPosition : delay);
  }

  private updateGraphics(): void {
    const g0 = this.vdelp0 ? this.grp0Old : this.grp0;
    const g1 = this.vdelp1 ? this.grp1Old : this.grp1;
    this.p0Gfx = this.refp0 ? REVERSED[g0] : g0;
    this.p1Gfx = this.refp1 ? REVERSED[g1] : g1;
    this.m0On = this.enam0 !== 0 && this.resmp0 === 0;
    this.m1On = this.enam1 !== 0 && this.resmp1 === 0;
    this.blOn = (this.vdelbl ? this.enablOld : this.enabl) !== 0;
  }

  /** Expands PF0-PF2 into the 40 four-pixel cells of a line (the right half repeated or mirrored). */
  private updatePlayfield(): void {
    const cells = this.pfCells;
    for (let i = 0; i < 4; i++) cells[i] = (this.pf0 >> (4 + i)) & 1;
    for (let i = 0; i < 8; i++) cells[4 + i] = (this.pf1 >> (7 - i)) & 1;
    for (let i = 0; i < 8; i++) cells[12 + i] = (this.pf2 >> i) & 1;
    const mirror = (this.ctrlpf & 0x01) !== 0;
    for (let i = 0; i < 20; i++) cells[20 + i] = mirror ? cells[19 - i] : cells[i];
  }

  // --- Inputs ----------------------------------------------------------------------

  private potBit(index: number): number {
    if (this.vblank & 0x80) return 0;
    return this.colorClocks - this.dumpReleasedAt >= this.inputs.potChargeClocks(index) ? 0x80 : 0;
  }

  private fireBit(index: number): number {
    const pressed = this.inputs.firePressed(index);
    if (this.vblank & 0x40) {
      if (pressed) {
        if (index === 0) this.latch0 = false;
        else this.latch1 = false;
      }
      return (index === 0 ? this.latch0 : this.latch1) ? 0x80 : 0;
    }
    return pressed ? 0 : 0x80;
  }

  /** Call when the controllers change, so latched fire buttons catch presses between reads. */
  inputsChanged(): void {
    if (!(this.vblank & 0x40)) return;
    if (this.inputs.firePressed(0)) this.latch0 = false;
    if (this.inputs.firePressed(1)) this.latch1 = false;
  }
}
