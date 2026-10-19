import { describe, expect, it } from 'vitest';
import { Atari2600 } from '../src/atari2600';
import { createCartridge, detectScheme } from '../src/cart/detect';
import { assemble } from './helpers/asm';

/** An image of `banks` x `bankSize` bytes where every byte of bank n is n (plus optional patches). */
function image(banks: number, bankSize = 0x1000, patches: [number, number[]][] = []): Uint8Array {
  const rom = new Uint8Array(banks * bankSize);
  for (let bank = 0; bank < banks; bank++) rom.fill(bank + 1, bank * bankSize, (bank + 1) * bankSize);
  for (const [offset, bytes] of patches) rom.set(bytes, offset);
  return rom;
}

describe('scheme detection', () => {
  it('goes by size for plain and Atari images', () => {
    expect(detectScheme(new Uint8Array(0x800))).toBe('2K');
    expect(detectScheme(image(1))).toBe('4K');
    expect(detectScheme(image(2, 0x1000, [[0x10, [1, 2, 3]], [0x1010, [1, 2, 3]]]))).toBe('F8');
    expect(detectScheme(image(3, 0x1000, [[0x10, [1]], [0x1010, [1]], [0x2010, [1]]]))).toBe('FA');
    expect(detectScheme(image(4, 0x1000, [[0x10, [1]], [0x1010, [1]], [0x2010, [1]], [0x3010, [1]]]))).toBe('F6');
  });

  it('recognises Superchip images by their filler RAM area', () => {
    expect(detectScheme(image(2))).toBe('F8SC');
    expect(detectScheme(image(8))).toBe('F4SC');
  });

  it('recognises schemes by the code that switches banks', () => {
    const noSc: [number, number[]][] = [[0x10, [0xaa]], [0x1010, [0xaa]]];
    expect(detectScheme(image(2, 0x1000, [...noSc, [0x500, [0x8d, 0xe0, 0x1f]]]))).toBe('E0');
    expect(detectScheme(image(2, 0x1000, [...noSc, [0x500, [0x85, 0x3f]], [0x600, [0x85, 0x3f]]]))).toBe('3F');
    expect(detectScheme(image(2, 0x1000, [...noSc, [0x500, [0x85, 0x3e, 0xa9, 0x00]]]))).toBe('3E');
    expect(detectScheme(image(2, 0x1000, [...noSc, [0x500, [0x8d, 0x40, 0x02]]]))).toBe('UA');
    expect(detectScheme(image(2, 0x1000, [...noSc, [0x500, [0x20, 0x00, 0xd0, 0xc6, 0xc5]]]))).toBe('FE');
    expect(detectScheme(image(2, 0x1000, [...noSc, [0x500, [0xad, 0x00, 0x08]], [0x600, [0xad, 0x40, 0x08]]]))).toBe('0840');
    const e7: [number, number[]][] = [0, 1, 2, 3].map((bank) => [bank * 0x1000 + 0x10, [0xaa]]);
    expect(detectScheme(image(4, 0x1000, [...e7, [0x500, [0xad, 0xe5, 0x1f]]]))).toBe('E7');
    expect(detectScheme(image(1, 0x800, [[0x10, [0x9d, 0xff, 0xf3]]]))).toBe('CV');
  });
});

describe('Atari schemes', () => {
  it('switches F8 banks on hotspot reads and writes, starting in the last bank', () => {
    const cart = createCartridge(image(2), 'F8');
    expect(cart.read(0x000)).toBe(2);
    cart.read(0xff8);
    expect(cart.read(0x000)).toBe(1);
    cart.write(0xff9, 0);
    expect(cart.read(0x000)).toBe(2);
  });

  it('switches F6 and F4 banks', () => {
    const f6 = createCartridge(image(4), 'F6');
    f6.read(0xff7);
    expect(f6.read(0x200)).toBe(2);
    const f4 = createCartridge(image(8), 'F4');
    f4.read(0xffb);
    expect(f4.read(0x200)).toBe(8);
    f4.read(0xff4);
    expect(f4.read(0x200)).toBe(1);
  });

  it('gives Superchip carts 128 bytes of RAM (write low, read high)', () => {
    const cart = createCartridge(image(2), 'F8SC');
    cart.write(0x010, 0x5a);
    expect(cart.read(0x090)).toBe(0x5a);
    expect(cart.read(0x200)).toBe(2);
  });

  it('gives CBS RAM Plus carts 256 bytes of RAM', () => {
    const cart = createCartridge(image(3), 'FA');
    cart.write(0x0f0, 0x33);
    expect(cart.read(0x1f0)).toBe(0x33);
    cart.read(0xff9);
    expect(cart.read(0x300)).toBe(2);
  });
});

describe('other schemes', () => {
  it('maps E0 slices', () => {
    const cart = createCartridge(image(8, 0x400), 'E0');
    expect(cart.read(0x000)).toBe(5);
    expect(cart.read(0xc00)).toBe(8);
    cart.read(0xfe2); // slice 2 into window 0
    expect(cart.read(0x000)).toBe(3);
    cart.read(0xff1); // slice 1 into window 2
    expect(cart.read(0x800)).toBe(2);
  });

  it('maps E7 ROM banks and both RAM areas', () => {
    const cart = createCartridge(image(8, 0x800), 'E7');
    cart.read(0xfe3);
    expect(cart.read(0x100)).toBe(4);
    expect(cart.read(0xb00)).toBe(8);
    cart.read(0xfe7);
    cart.write(0x020, 0x11);
    expect(cart.read(0x420)).toBe(0x11);
    cart.read(0xfe9);
    cart.write(0x830, 0x22);
    expect(cart.read(0x930)).toBe(0x22);
    cart.read(0xfe8);
    expect(cart.read(0x930)).toBe(0);
  });

  it('switches 3F banks on writes to TIA addresses', () => {
    const cart = createCartridge(image(4, 0x800), '3F');
    expect(cart.read(0x800)).toBe(4);
    cart.snoop(0x3f, 2, true);
    expect(cart.read(0x000)).toBe(3);
    cart.snoop(0x3f, 1, false);
    expect(cart.read(0x000)).toBe(3);
  });

  it('pages 3E RAM in and out', () => {
    const cart = createCartridge(image(4, 0x800), '3E');
    cart.snoop(0x3e, 1, true);
    cart.write(0x410, 0x77);
    expect(cart.read(0x010)).toBe(0x77);
    cart.snoop(0x3f, 0, true);
    expect(cart.read(0x010)).toBe(1);
  });

  it('switches FE banks from the stack accesses of JSR and RTS', () => {
    const cart = createCartridge(image(2), 'FE');
    cart.snoop(0x01fe, 0x00, true);
    cart.snoop(0x1ffe, 0xd0, false);
    expect(cart.read(0)).toBe(2);
    cart.snoop(0x01fe, 0x00, false);
    cart.snoop(0x01ff, 0xf0, false);
    expect(cart.read(0)).toBe(1);
  });

  it('switches UA and 0840 banks on their hotspots', () => {
    const ua = createCartridge(image(2), 'UA');
    ua.snoop(0x0240, 0, false);
    expect(ua.read(0)).toBe(2);
    ua.snoop(0x0220, 0, true);
    expect(ua.read(0)).toBe(1);
    const econo = createCartridge(image(2), '0840');
    econo.snoop(0x0840, 0, false);
    expect(econo.read(0)).toBe(2);
  });

  it('maps Commavid RAM', () => {
    const cart = createCartridge(image(1, 0x800), 'CV');
    cart.write(0x410, 9);
    expect(cart.read(0x010)).toBe(9);
    expect(cart.read(0x800)).toBe(1);
  });

  it('pads small images and repeats 2K images', () => {
    const cart = createCartridge(image(1, 0x800), '2K');
    expect(cart.read(0xfff)).toBe(1);
    expect(() => createCartridge(new Uint8Array(0))).toThrow();
  });
});

describe('bank switching on the machine', () => {
  it('runs code that switches from the start bank to another F8 bank', () => {
    const bank0 = assemble(`
      .org $F000
      nop
      nop
      nop
      lda #$42
      sta $80
Halt: jmp Halt
      .org $FFFC
      .word $F000
      .word $F000
    `);
    const bank1 = assemble(`
      .org $F000
Start: lda $1FF8
      .org $FFFC
      .word Start
      .word Start
    `);
    const rom = new Uint8Array(0x2000);
    rom.set(bank0, 0);
    rom.set(bank1, 0x1000);
    rom.fill(0xea, 0x1003, 0x1006);
    const machine = new Atari2600();
    machine.insertCartridge(createCartridge(rom, 'F8'));
    machine.runCycles(200);
    expect(machine.riot.ram[0]).toBe(0x42);
  });
});
