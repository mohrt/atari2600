import type { Cartridge, SchemeName } from './cartridge';
import { AtariBankedCartridge, isAtariScheme } from './schemes/atari';
import { PlainCartridge } from './schemes/plain';
import { MNetworkE7Cartridge, ParkerE0Cartridge, TigervisionCartridge } from './schemes/segmented';
import { ActivisionFECartridge, CommavidCartridge, EconoBankingCartridge, UACartridge } from './schemes/snooping';

/** How many times `pattern` appears in `rom`. */
function countPattern(rom: Uint8Array, pattern: number[]): number {
  let count = 0;
  outer: for (let i = 0; i <= rom.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) if (rom[i + j] !== pattern[j]) continue outer;
    count++;
  }
  return count;
}

function hasAny(rom: Uint8Array, patterns: number[][], minimum = 1): boolean {
  return patterns.reduce((total, pattern) => total + countPattern(rom, pattern), 0) >= minimum;
}

/** Superchip games leave the RAM area as filler: each bank's first 128 bytes repeat in the next 128. */
function isProbablySC(rom: Uint8Array): boolean {
  for (let bank = 0; bank < rom.length; bank += 0x1000) {
    for (let i = 0; i < 128; i++) if (rom[bank + i] !== rom[bank + 128 + i]) return false;
  }
  return true;
}

// Code signatures (instructions that touch each scheme's hotspots).
const E0_SIGNATURES = [
  [0x8d, 0xe0, 0x1f], // STA $1FE0
  [0x8d, 0xe0, 0x5f], // STA $5FE0
  [0x8d, 0xe9, 0xff], // STA $FFE9
  [0x0c, 0xe0, 0x1f], // NOP $1FE0
  [0xad, 0xe0, 0x1f], // LDA $1FE0
  [0xad, 0xe9, 0xff], // LDA $FFE9
  [0xad, 0xed, 0xff], // LDA $FFED
  [0xad, 0xf3, 0xbf], // LDA $BFF3
];
const E7_SIGNATURES = [
  [0xad, 0xe2, 0xff], // LDA $FFE2
  [0xad, 0xe5, 0xff], // LDA $FFE5
  [0xad, 0xe5, 0x1f], // LDA $1FE5
  [0xad, 0xe7, 0x1f], // LDA $1FE7
  [0x0c, 0xe7, 0x1f], // NOP $1FE7
  [0x8d, 0xe7, 0xff], // STA $FFE7
  [0x8d, 0xe7, 0x1f], // STA $1FE7
];
const FE_SIGNATURES = [
  [0x20, 0x00, 0xd0, 0xc6, 0xc5], // JSR $D000; DEC $C5
  [0x20, 0xc3, 0xf8, 0xa5, 0x82], // JSR $F8C3; LDA $82
  [0xd0, 0xfb, 0x20, 0x73, 0xfe], // BNE -5; JSR $FE73
  [0x20, 0x00, 0xf0, 0x84, 0xd6], // JSR $F000; STY $D6
];
const UA_SIGNATURES = [
  [0x8d, 0x40, 0x02], // STA $240
  [0xad, 0x40, 0x02], // LDA $240
  [0xbd, 0x1f, 0x02], // LDA $21F,X
  [0x2c, 0xc0, 0x02], // BIT $2C0
];
const ECONOBANKING_SIGNATURES = [
  [0xad, 0x00, 0x08], // LDA $0800
  [0xad, 0x40, 0x08], // LDA $0840
  [0x2c, 0x00, 0x08], // BIT $0800
  [0x2c, 0x40, 0x08], // BIT $0840
];
const CV_SIGNATURES = [
  [0x9d, 0xff, 0xf3], // STA $F3FF,X
  [0x99, 0x00, 0xf4], // STA $F400,Y
];
const is3F = (rom: Uint8Array) => countPattern(rom, [0x85, 0x3f]) >= 2; // STA $3F
const is3E = (rom: Uint8Array) => countPattern(rom, [0x85, 0x3e, 0xa9, 0x00]) >= 1; // STA $3E; LDA #$00

/** Guesses the bank-switching scheme from the image size and the code in it. */
export function detectScheme(rom: Uint8Array): SchemeName {
  const size = rom.length;
  if (size <= 0x800) return hasAny(rom, CV_SIGNATURES) ? 'CV' : '2K';
  if (size === 0x1000) return '4K';
  if (size === 0x2000) {
    if (isProbablySC(rom)) return 'F8SC';
    if (hasAny(rom, E0_SIGNATURES)) return 'E0';
    if (is3E(rom)) return '3E';
    if (is3F(rom)) return '3F';
    if (hasAny(rom, UA_SIGNATURES)) return 'UA';
    if (hasAny(rom, FE_SIGNATURES)) return 'FE';
    if (hasAny(rom, ECONOBANKING_SIGNATURES, 2)) return '0840';
    return 'F8';
  }
  if (size === 0x3000) return 'FA';
  if (size === 0x4000) {
    if (isProbablySC(rom)) return 'F6SC';
    if (hasAny(rom, E7_SIGNATURES)) return 'E7';
    if (is3E(rom)) return '3E';
    if (is3F(rom)) return '3F';
    return 'F6';
  }
  if (size === 0x8000) {
    if (isProbablySC(rom)) return 'F4SC';
    if (is3E(rom)) return '3E';
    if (is3F(rom)) return '3F';
    return 'F4';
  }
  if (size === 0x10000) {
    if (is3E(rom)) return '3E';
    if (is3F(rom)) return '3F';
    return isProbablySC(rom) ? 'EFSC' : 'EF';
  }
  return is3E(rom) ? '3E' : '3F';
}

/** Bytes each scheme needs; smaller images are padded at the front (as their code expects the end). */
const SCHEME_SIZES: Partial<Record<SchemeName, number>> = {
  '2K': 0x800,
  '4K': 0x1000,
  CV: 0x800,
  F8: 0x2000,
  F8SC: 0x2000,
  F6: 0x4000,
  F6SC: 0x4000,
  F4: 0x8000,
  F4SC: 0x8000,
  EF: 0x10000,
  EFSC: 0x10000,
  FE: 0x2000,
  E0: 0x2000,
  E7: 0x4000,
  FA: 0x3000,
  UA: 0x2000,
  '0840': 0x2000,
};

/** Pads or trims an image to the size a scheme expects, keeping the end (where the reset vector is). */
function fitImage(rom: Uint8Array, scheme: SchemeName): Uint8Array {
  let size = SCHEME_SIZES[scheme];
  if (size === undefined) size = Math.max(0x800, Math.ceil(rom.length / 0x800) * 0x800);
  if (rom.length === size) return rom;
  const fitted = new Uint8Array(size);
  if (rom.length > size) fitted.set(rom.subarray(rom.length - size));
  else if (scheme === '2K' || scheme === '4K') {
    // Small images repeat to fill the space.
    for (let i = 0; i < size; i += rom.length) fitted.set(rom.subarray(0, Math.min(rom.length, size - i)), i);
  } else fitted.set(rom, size - rom.length);
  return fitted;
}

/** Builds the cartridge for an image, detecting the scheme unless one is given. */
export function createCartridge(image: Uint8Array, scheme: SchemeName = detectScheme(image)): Cartridge {
  if (image.length === 0) throw new Error('That file is empty.');
  if (image.length > 0x80000) throw new Error('That file is too big to be an Atari 2600 cartridge.');
  const rom = fitImage(image, scheme);
  if (scheme === '2K' || scheme === '4K') return new PlainCartridge(rom);
  if (isAtariScheme(scheme)) return new AtariBankedCartridge(rom, scheme);
  switch (scheme) {
    case 'CV': return new CommavidCartridge(rom);
    case 'FE': return new ActivisionFECartridge(rom);
    case 'E0': return new ParkerE0Cartridge(rom);
    case 'E7': return new MNetworkE7Cartridge(rom);
    case '3F': return new TigervisionCartridge(rom, '3F');
    case '3E': return new TigervisionCartridge(rom, '3E');
    case 'UA': return new UACartridge(rom);
    case '0840': return new EconoBankingCartridge(rom);
    default: throw new Error(`Unsupported scheme ${scheme}`);
  }
}
