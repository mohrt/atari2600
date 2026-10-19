import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Atari2600 } from '../src/atari2600';
import { createCartridge, detectScheme } from '../src/cart/detect';
import { parseGameManifest } from '../src/games';
import { ControllerPorts } from '../src/io/controllers/ports';
import { framePng } from './helpers/png';
import { watchFrames } from './helpers/machine';

const gamesDir = join(import.meta.dirname, '..', 'public', 'games');
const manifestPath = join(gamesDir, 'index.json');
const games = existsSync(manifestPath) ? parseGameManifest(JSON.parse(readFileSync(manifestPath, 'utf8'))) : [];
/** Set SHOTS=<dir> to save a screenshot of each game. */
const shotsDir = process.env.SHOTS;

describe.skipIf(games.length === 0)('free games', () => {
  for (const game of games) {
    it(`${game.title} boots to a steady, drawn picture`, () => {
      const image = new Uint8Array(readFileSync(join(gamesDir, game.file)));
      const machine = new Atari2600();
      const frame = watchFrames(machine);
      const ports = new ControllerPorts(machine);
      if (game.controller) ports.setType(0, game.controller);
      machine.insertCartridge(createCartridge(image, detectScheme(image)));

      for (let i = 0; i < 120; i++) machine.runFrame();
      // Press Reset and fire for a moment to get past title screens.
      ports.switches.buttons.set('test', true, false);
      for (let i = 0; i < 10; i++) machine.runFrame();
      ports.switches.buttons.set('test', false, false);
      ports.players[0].set('test', { fire: true });
      for (let i = 0; i < 10; i++) machine.runFrame();
      ports.players[0].clear('test');
      for (let i = 0; i < 60; i++) machine.runFrame();

      const lineCounts = new Set<number>();
      for (let i = 0; i < 10; i++) {
        machine.runFrame();
        lineCounts.add(frame().info.lines);
      }
      const { pixels, info } = frame();
      expect(info.synced).toBe(true);
      for (const lines of lineCounts) expect(Math.abs(lines - 262)).toBeLessThanOrEqual(6);
      const colors = new Set(pixels.subarray(30 * 160, (info.lines - 20) * 160));
      expect(colors.size).toBeGreaterThan(2);
      expect(machine.cpu.jammedAt).toBe(-1);

      if (shotsDir) {
        mkdirSync(shotsDir, { recursive: true });
        writeFileSync(join(shotsDir, `${game.file}.png`), framePng(pixels, info.lines));
      }
    });
  }
});
