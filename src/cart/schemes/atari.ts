import { BaseCartridge, type SchemeName } from '../cartridge';

const BANK_SIZE = 0x1000;

interface AtariLayout {
  /** First hotspot offset; hotspot n selects bank n. */
  hotspot: number;
  /** Bytes of extra RAM at the start of each bank: write port, then read port. */
  ramSize: number;
}

const LAYOUTS: Partial<Record<SchemeName, AtariLayout>> = {
  F8: { hotspot: 0xff8, ramSize: 0 },
  F8SC: { hotspot: 0xff8, ramSize: 128 },
  F6: { hotspot: 0xff6, ramSize: 0 },
  F6SC: { hotspot: 0xff6, ramSize: 128 },
  F4: { hotspot: 0xff4, ramSize: 0 },
  F4SC: { hotspot: 0xff4, ramSize: 128 },
  EF: { hotspot: 0xfe0, ramSize: 0 },
  EFSC: { hotspot: 0xfe0, ramSize: 128 },
  FA: { hotspot: 0xff8, ramSize: 256 },
};

/**
 * Atari's own schemes: 4K banks chosen by touching (reading or writing) a
 * hotspot near the top of the address space. F8 = 8K, F6 = 16K, F4 = 32K,
 * EF = 64K. The SC versions add the 128-byte Superchip RAM (write at
 * $1000-$107F, read at $1080-$10FF); CBS RAM Plus (FA) is 12K with 256 bytes
 * (write at $1000-$10FF, read at $1100-$11FF).
 */
export class AtariBankedCartridge extends BaseCartridge {
  readonly scheme: SchemeName;
  readonly ram: Uint8Array;
  bank = 0;
  private readonly bankCount: number;
  private readonly hotspot: number;
  private readonly ramSize: number;

  constructor(rom: Uint8Array, scheme: SchemeName) {
    super(rom);
    const layout = LAYOUTS[scheme];
    if (!layout) throw new Error(`${scheme} is not an Atari bank-switching scheme`);
    this.scheme = scheme;
    this.bankCount = rom.length / BANK_SIZE;
    this.hotspot = layout.hotspot;
    this.ramSize = layout.ramSize;
    this.ram = new Uint8Array(layout.ramSize);
    this.reset();
  }

  reset(): void {
    this.ram.fill(0);
    this.bank = this.bankCount - 1;
  }

  private touch(offset: number): void {
    const n = offset - this.hotspot;
    if (n >= 0 && n < this.bankCount) this.bank = n;
  }

  read(offset: number): number {
    if (offset < this.ramSize * 2) {
      if (offset >= this.ramSize) return this.ram[offset - this.ramSize];
      // Reading the write port returns nothing useful.
      return 0xff;
    }
    this.touch(offset);
    return this.rom[this.bank * BANK_SIZE + offset];
  }

  write(offset: number, value: number): void {
    if (offset < this.ramSize) {
      this.ram[offset] = value;
      return;
    }
    this.touch(offset);
  }
}

/** Atari scheme names, for detection. */
export function isAtariScheme(scheme: SchemeName): boolean {
  return scheme in LAYOUTS;
}
