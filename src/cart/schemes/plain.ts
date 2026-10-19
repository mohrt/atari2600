import { BaseCartridge, type SchemeName } from '../cartridge';

/** 2K or 4K of ROM with no bank switching (2K images appear twice). */
export class PlainCartridge extends BaseCartridge {
  readonly scheme: SchemeName;
  private readonly mask: number;

  constructor(rom: Uint8Array) {
    super(rom);
    this.scheme = rom.length <= 0x800 ? '2K' : '4K';
    this.mask = rom.length <= 0x800 ? 0x7ff : 0xfff;
  }

  read(offset: number): number {
    return this.rom[offset & this.mask];
  }

  reset(): void {}
}
