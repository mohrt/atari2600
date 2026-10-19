import { describe, expect, it } from 'vitest';
import { Atari2600 } from '../src/atari2600';
import { createCartridge } from '../src/cart/detect';
import { SaveStates, decodeSession, encodeSession, type Session } from '../src/storage/save-states';
import { MemoryStore } from '../src/storage/store';
import { assemble } from './helpers/asm';
import { frameLoop, watchFrames } from './helpers/machine';

function bankedRom(): Uint8Array {
  const bank = assemble(`${frameLoop('  lda #$1e\n  sta COLUBK', '  inc $80')}\n.org $FFFC\n.word Start\n.word Start`);
  const rom = new Uint8Array(0x2000);
  rom.set(bank, 0);
  rom.set(bank, 0x1000);
  return rom;
}

function session(machine: Atari2600, rom: Uint8Array): Session {
  return {
    machine: machine.saveState(),
    rom,
    romName: 'test.bin',
    title: 'Test',
    scheme: 'F8',
    controllers: ['joystick', 'joystick'],
    switches: { color: true, leftDifficultyA: false, rightDifficultyA: false },
  };
}

describe('save states', () => {
  it('restore the machine to exactly where it was', async () => {
    const rom = bankedRom();
    const machine = new Atari2600();
    machine.insertCartridge(createCartridge(rom, 'F8'));
    for (let i = 0; i < 5; i++) machine.runFrame();
    const saved = await encodeSession(session(machine, rom));
    for (let i = 0; i < 3; i++) machine.runFrame();
    const later = { ram: machine.riot.ram.slice(), cycles: machine.cycles };

    const restored = await decodeSession(saved);
    const copy = new Atari2600();
    const frame = watchFrames(copy);
    copy.insertCartridge(createCartridge(restored.rom, restored.scheme));
    copy.loadState(restored.machine);
    for (let i = 0; i < 3; i++) copy.runFrame();
    expect(copy.riot.ram).toEqual(later.ram);
    expect(copy.cycles).toBe(later.cycles);
    expect(frame().info.lines).toBe(262);
  });

  it('are listed newest first and can be deleted', async () => {
    const rom = bankedRom();
    const machine = new Atari2600();
    machine.insertCartridge(createCartridge(rom, 'F8'));
    const states = new SaveStates(new MemoryStore());
    await states.add('First', session(machine, rom));
    await new Promise((resolve) => setTimeout(resolve, 2));
    await states.add('Second', session(machine, rom));
    const list = await states.list();
    expect(list.map((state) => state.name)).toEqual(['Second', 'First']);
    await states.delete(list[0].id);
    expect((await states.list()).length).toBe(1);
    expect((await states.load(list[1].id))?.title).toBe('Test');
  });

  it('rejects files that are not save states', async () => {
    await expect(decodeSession(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});
