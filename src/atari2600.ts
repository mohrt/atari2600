import type { Cartridge } from './cart/cartridge';
import { Cpu6507, type CpuBus } from './cpu/cpu6507';
import { Riot6532 } from './riot/riot6532';
import { captureState, restoreState, type StateNode } from './state/snapshot';
import { CLOCKS_PER_LINE, Tia } from './tia/tia';

export type TvStandard = 'ntsc' | 'pal' | 'secam';

/** CPU clock (colour clock / 3) for each TV standard. */
export const CPU_CLOCK_HZ: Record<TvStandard, number> = {
  ntsc: 3_579_545 / 3,
  pal: 3_546_894 / 3,
  secam: 3_546_894 / 3,
};

/** A frame is never longer than this many CPU cycles (MAX_FRAME_LINES lines of 76 cycles), plus slack. */
const MAX_FRAME_CYCLES = 400 * 76 + 1000;

export interface MachineState {
  tv: TvStandard;
  state: StateNode;
}

/**
 * The Atari 2600: a 6507 CPU, the TIA (video, sound, paddle and fire inputs),
 * the RIOT (RAM, timer, joystick and switch ports) and a cartridge, on a
 * 13-bit address bus. Every CPU bus access is one cycle, which advances the
 * TIA three colour clocks and the RIOT one tick.
 */
export class Atari2600 implements CpuBus {
  readonly cpu: Cpu6507;
  readonly tia = new Tia();
  readonly riot = new Riot6532();
  cartridge: Cartridge | null = null;
  tv: TvStandard = 'ntsc';
  /** The last value on the data bus (TIA reads leave the low bits floating at this). */
  dataBus = 0;
  cycles = 0;
  private snoop = false;

  constructor() {
    this.cpu = new Cpu6507(this);
  }

  get clockHz(): number {
    return CPU_CLOCK_HZ[this.tv];
  }

  /** The TIA's audio clock: twice per scanline. */
  get audioClockHz(): number {
    return (this.clockHz * 3 * 2) / CLOCKS_PER_LINE;
  }

  insertCartridge(cartridge: Cartridge | null): void {
    this.cartridge = cartridge;
    this.snoop = cartridge?.snoops ?? false;
    this.reset();
  }

  /** Powers the console off and on again (the cartridge stays in). */
  reset(): void {
    this.riot.reset();
    this.tia.reset();
    this.cartridge?.reset();
    this.dataBus = 0;
    this.cpu.a = this.cpu.x = this.cpu.y = 0;
    this.cpu.status = 0;
    this.cpu.reset();
  }

  setTv(tv: TvStandard): void {
    this.tv = tv;
  }

  private tick(): void {
    this.tia.clock3();
    this.riot.tick();
    this.cycles++;
  }

  read(addr: number): number {
    // WSYNC pulls RDY low: the CPU stalls on its next read until the line ends.
    while (this.tia.wsync) this.tick();
    this.tick();
    addr &= 0x1fff;
    let value: number;
    if (addr & 0x1000) value = this.cartridge ? this.cartridge.read(addr & 0x0fff) : this.dataBus;
    else if (!(addr & 0x80)) value = this.tia.read(addr, this.dataBus);
    else if (!(addr & 0x200)) value = this.riot.ram[addr & 0x7f];
    else value = this.riot.readIo(addr);
    if (this.snoop) this.cartridge!.snoop(addr, value, false);
    this.dataBus = value;
    return value;
  }

  write(addr: number, value: number): void {
    this.tick();
    addr &= 0x1fff;
    this.dataBus = value;
    if (addr & 0x1000) this.cartridge?.write(addr & 0x0fff, value);
    else if (!(addr & 0x80)) this.tia.write(addr, value);
    else if (!(addr & 0x200)) this.riot.ram[addr & 0x7f] = value;
    else this.riot.writeIo(addr, value);
    if (this.snoop) this.cartridge!.snoop(addr, value, true);
  }

  /** Runs at least `cycles` CPU cycles (finishing the current instruction); returns how many ran. */
  runCycles(cycles: number): number {
    const start = this.cycles;
    const target = start + cycles;
    while (this.cycles < target) this.cpu.step();
    return this.cycles - start;
  }

  /** Runs until the TIA finishes a frame. */
  runFrame(): void {
    const frame = this.tia.frameCount;
    const limit = this.cycles + MAX_FRAME_CYCLES;
    while (this.tia.frameCount === frame && this.cycles < limit) this.cpu.step();
  }

  saveState(): MachineState {
    return { tv: this.tv, state: captureState(this) };
  }

  loadState(saved: MachineState): void {
    this.tv = saved.tv;
    restoreState(this, saved.state);
  }
}
