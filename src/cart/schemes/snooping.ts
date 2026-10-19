import { BaseCartridge, type SchemeName } from '../cartridge';

/** 8K in two 4K banks, switched by accesses the cartridge sees outside its own address range. */
abstract class TwoBankSnoopingCartridge extends BaseCartridge {
  readonly snoops = true;
  bank = 0;

  reset(): void {
    this.bank = 0;
  }

  read(offset: number): number {
    return this.rom[this.bank * 0x1000 + offset];
  }
}

/**
 * Activision FE: watches the stack. The access after one to $01FE (JSR
 * pushing, or RTS pulling, the return address) carries the high byte of
 * that address; its bit 5 picks the bank ($Fxxx code in bank 0, $Dxxx in 1).
 */
export class ActivisionFECartridge extends TwoBankSnoopingCartridge {
  readonly scheme: SchemeName = 'FE';
  sawStackAccess = false;

  reset(): void {
    super.reset();
    this.sawStackAccess = false;
  }

  snoop(addr: number, value: number): void {
    if (this.sawStackAccess) {
      this.bank = value & 0x20 ? 0 : 1;
      this.sawStackAccess = false;
    }
    if (addr === 0x01fe) this.sawStackAccess = true;
  }
}

/** UA Ltd: touching $0220 selects bank 0 and $0240 bank 1 (address lines A5, A6, A9, A12). */
export class UACartridge extends TwoBankSnoopingCartridge {
  readonly scheme: SchemeName = 'UA';

  snoop(addr: number): void {
    const decoded = addr & 0x1260;
    if (decoded === 0x0220) this.bank = 0;
    else if (decoded === 0x0240) this.bank = 1;
  }
}

/** EconoBanking 0840: touching $0800 selects bank 0 and $0840 bank 1 (A6, A11, A12). */
export class EconoBankingCartridge extends TwoBankSnoopingCartridge {
  readonly scheme: SchemeName = '0840';

  snoop(addr: number): void {
    const decoded = addr & 0x1840;
    if (decoded === 0x0800) this.bank = 0;
    else if (decoded === 0x0840) this.bank = 1;
  }
}

/** Commavid CV: 2K ROM at $1800-$1FFF and 1K RAM (read $1000-$13FF, write $1400-$17FF). */
export class CommavidCartridge extends BaseCartridge {
  readonly scheme: SchemeName = 'CV';
  readonly ram = new Uint8Array(0x400);

  reset(): void {
    this.ram.fill(0);
  }

  read(offset: number): number {
    if (offset >= 0x800) return this.rom[(offset & 0x7ff) + (this.rom.length - 0x800)];
    return offset < 0x400 ? this.ram[offset] : 0xff;
  }

  write(offset: number, value: number): void {
    if (offset >= 0x400 && offset < 0x800) this.ram[offset - 0x400] = value;
  }
}
