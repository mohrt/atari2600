import { describe, expect, it } from 'vitest';
import { FrameWindow, TvDetector, WINDOW_LINES } from '../src/render/frame-window';
import { PALETTES } from '../src/render/palette';
import type { FrameInfo } from '../src/tia/tia';

const frame = (firstVisible: number, lastVisible: number, lines = 262, synced = true): FrameInfo => ({
  lines,
  firstVisible,
  lastVisible,
  synced,
});

describe('FrameWindow', () => {
  it('centres the visible lines in the window', () => {
    const window = new FrameWindow('ntsc');
    window.update(frame(40, 231));
    expect(window.top).toBe(40 - (WINDOW_LINES.ntsc - 192) / 2);
  });

  it('waits a few frames before following a change', () => {
    const window = new FrameWindow('ntsc');
    window.update(frame(40, 231));
    const top = window.top;
    window.update(frame(50, 241));
    expect(window.top).toBe(top);
    for (let i = 0; i < 4; i++) window.update(frame(50, 241));
    expect(window.top).toBe(top + 10);
  });

  it('ignores a single odd frame', () => {
    const window = new FrameWindow('ntsc');
    window.update(frame(40, 231));
    const top = window.top;
    window.update(frame(80, 120));
    window.update(frame(40, 231));
    expect(window.top).toBe(top);
  });

  it('keeps the default position for games that never blank', () => {
    const window = new FrameWindow('ntsc');
    const top = window.top;
    window.update(frame(0, 261));
    expect(window.top).toBe(top);
  });
});

describe('TvDetector', () => {
  it('detects PAL from 312-line frames and NTSC from 262-line frames', () => {
    const detector = new TvDetector();
    let result: string | null = null;
    for (let i = 0; i < 30; i++) result = detector.update(frame(40, 250, 312));
    expect(result).toBe('pal');
    detector.reset();
    for (let i = 0; i < 30; i++) result = detector.update(frame(40, 231, 262));
    expect(result).toBe('ntsc');
  });
});

describe('palettes', () => {
  it('has opaque colours with black at index 0 and white-ish at the top grey', () => {
    for (const palette of Object.values(PALETTES)) {
      expect(palette.length).toBe(128);
      expect(palette[0]).toBe(0xff000000);
      expect(palette.every((color) => color >>> 24 === 0xff)).toBe(true);
    }
    expect(PALETTES.ntsc[7] & 0xff).toBeGreaterThan(220);
  });

  it('gives NTSC hue 4 a red tint and hue 8 a blue tint', () => {
    const rgb = (word: number) => [word & 0xff, (word >> 8) & 0xff, (word >> 16) & 0xff];
    const [r4, , b4] = rgb(PALETTES.ntsc[4 * 8 + 4]);
    const [r8, , b8] = rgb(PALETTES.ntsc[8 * 8 + 4]);
    expect(r4).toBeGreaterThan(b4);
    expect(b8).toBeGreaterThan(r8);
  });
});
