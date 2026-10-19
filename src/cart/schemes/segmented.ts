import { BaseCartridge, type SchemeName } from '../cartridge';

/**
 * Parker Brothers E0 (8K): the 4K window is four 1K slices. The last always
 * shows ROM slice 7; touching $1FE0-$1FE7, $1FE8-$1FEF or $1FF0-$1FF7 puts
 * slice 0-7 into the first, second or third window slice.
 */
export class ParkerE0Cartridge extends BaseCartridge {
  readonly scheme: SchemeName = 'E0';
  readonly slices = new Uint8Array(4);

  constructor(rom: Uint8Array) {
    super(rom);
    this.reset();
  }

  reset(): void {
    this.slices.set([4, 5, 6, 7]);
  }

  private touch(offset: number): void {
    if (offset >= 0xfe0 && offset <= 0xff7) this.slices[(offset - 0xfe0) >> 3] = offset & 7;
  }

  read(offset: number): number {
    this.touch(offset);
    return this.rom[(this.slices[offset >> 10] << 10) | (offset & 0x3ff)];
  }
}

/**
 * M-Network E7 (16K, 2K banks). $1000-$17FF shows ROM bank 0-6 (hotspots
 * $1FE0-$1FE6) or, after $1FE7, 1K of RAM (write $1000-$13FF, read
 * $1400-$17FF). $1800-$19FF holds one of four 256-byte RAM banks (hotspots
 * $1FE8-$1FEB; write $1800-$18FF, read $1900-$19FF). $1A00-$1FFF is fixed to
 * the end of ROM bank 7.
 */
export class MNetworkE7Cartridge extends BaseCartridge {
  readonly scheme: SchemeName = 'E7';
  readonly ram = new Uint8Array(0x800);
  lowBank = 0;
  ramBank = 0;
  private readonly lastBank: number;

  constructor(rom: Uint8Array) {
    super(rom);
    this.lastBank = rom.length / 0x800 - 1;
    this.reset();
  }

  reset(): void {
    this.ram.fill(0);
    this.lowBank = 0;
    this.ramBank = 0;
  }

  private touch(offset: number): void {
    if (offset >= 0xfe0 && offset <= 0xfe7) this.lowBank = offset & 7;
    else if (offset >= 0xfe8 && offset <= 0xfeb) this.ramBank = offset & 3;
  }

  read(offset: number): number {
    this.touch(offset);
    if (offset < 0x800) {
      if (this.lowBank !== 7) return this.rom[this.lowBank * 0x800 + offset];
      return offset >= 0x400 ? this.ram[offset - 0x400] : 0xff;
    }
    if (offset < 0xa00) {
      return offset >= 0x900 ? this.ram[0x400 + this.ramBank * 0x100 + (offset & 0xff)] : 0xff;
    }
    return this.rom[this.lastBank * 0x800 + (offset - 0x800)];
  }

  write(offset: number, value: number): void {
    this.touch(offset);
    if (offset < 0x400 && this.lowBank === 7) this.ram[offset] = value;
    else if (offset >= 0x800 && offset < 0x900) this.ram[0x400 + this.ramBank * 0x100 + (offset & 0xff)] = value;
  }
}

/**
 * Tigervision 3F: 2K banks. Writing any value to $00-$3F (TIA addresses)
 * selects the bank shown at $1000-$17FF; $1800-$1FFF is fixed to the last.
 * 3E adds up to 32K of RAM: writing $3E selects a 1K RAM bank instead
 * (read $1000-$13FF, write $1400-$17FF), and writing $3F goes back to ROM.
 */
export class TigervisionCartridge extends BaseCartridge {
  readonly scheme: SchemeName;
  readonly snoops = true;
  readonly ram: Uint8Array;
  bank = 0;
  ramMode = false;
  private readonly bankCount: number;

  constructor(rom: Uint8Array, scheme: '3F' | '3E') {
    super(rom);
    this.scheme = scheme;
    this.bankCount = rom.length / 0x800;
    this.ram = new Uint8Array(scheme === '3E' ? 0x8000 : 0);
    this.reset();
  }

  reset(): void {
    this.ram.fill(0);
    this.bank = 0;
    this.ramMode = false;
  }

  snoop(addr: number, value: number, isWrite: boolean): void {
    if (!isWrite || addr > 0x3f) return;
    if (this.scheme === '3E' && addr === 0x3e) {
      this.bank = value % (this.ram.length / 0x400);
      this.ramMode = true;
    } else if (this.scheme === '3F' || addr === 0x3f) {
      this.bank = value % this.bankCount;
      this.ramMode = false;
    }
  }

  read(offset: number): number {
    if (offset >= 0x800) return this.rom[(this.bankCount - 1) * 0x800 + (offset - 0x800)];
    if (this.ramMode) return offset < 0x400 ? this.ram[this.bank * 0x400 + offset] : 0xff;
    return this.rom[this.bank * 0x800 + offset];
  }

  write(offset: number, value: number): void {
    if (this.ramMode && offset >= 0x400 && offset < 0x800) this.ram[this.bank * 0x400 + (offset - 0x400)] = value;
  }
}
