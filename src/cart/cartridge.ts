/** Bank-switching schemes, named as Stella and most 2600 tools name them. */
export const SCHEMES = [
  '2K',
  '4K',
  'CV',
  'F8',
  'F8SC',
  'F6',
  'F6SC',
  'F4',
  'F4SC',
  'EF',
  'EFSC',
  'FE',
  'E0',
  'E7',
  '3F',
  '3E',
  'FA',
  'UA',
  '0840',
] as const;
export type SchemeName = (typeof SCHEMES)[number];

/** A short description of each scheme, for the override menu. */
export const SCHEME_LABELS: Record<SchemeName, string> = {
  '2K': '2K',
  '4K': '4K',
  CV: 'CV (Commavid, 1K RAM)',
  F8: 'F8 (8K Atari)',
  F8SC: 'F8SC (8K + Superchip)',
  F6: 'F6 (16K Atari)',
  F6SC: 'F6SC (16K + Superchip)',
  F4: 'F4 (32K Atari)',
  F4SC: 'F4SC (32K + Superchip)',
  EF: 'EF (64K)',
  EFSC: 'EFSC (64K + Superchip)',
  FE: 'FE (8K Activision)',
  E0: 'E0 (8K Parker Bros)',
  E7: 'E7 (16K M-Network)',
  '3F': '3F (Tigervision)',
  '3E': '3E (3F + RAM)',
  FA: 'FA (12K CBS RAM Plus)',
  UA: 'UA (8K UA Ltd)',
  '0840': '0840 (8K EconoBanking)',
};

/**
 * A cartridge plugged into the slot. `read` and `write` see accesses to
 * $1000-$1FFF (as offsets 0-$FFF). Schemes that switch banks on accesses
 * elsewhere (TIA or RIOT addresses, or the stack) set `snoops` and get every
 * bus access through `snoop`.
 */
export interface Cartridge {
  readonly scheme: SchemeName;
  readonly snoops: boolean;
  read(offset: number): number;
  write(offset: number, value: number): void;
  snoop(addr: number, value: number, isWrite: boolean): void;
  /** Back to the power-on bank. */
  reset(): void;
}

/** Common base: the ROM image and the start-up behaviour. */
export abstract class BaseCartridge implements Cartridge {
  abstract readonly scheme: SchemeName;
  readonly snoops: boolean = false;

  constructor(protected readonly rom: Uint8Array) {}

  abstract read(offset: number): number;

  write(offset: number, _value: number): void {
    // Writes to plain ROM still count as accesses (bank-switching hotspots).
    this.read(offset);
  }

  snoop(_addr: number, _value: number, _isWrite: boolean): void {}

  abstract reset(): void;
}
