import { describe, expect, it } from 'vitest';
import { POLY4, POLY5, POLY9, TiaAudio } from '../src/tia/audio';

/** Runs the channel for `clocks` audio clocks and returns channel 0's level after each. */
function levels(audio: TiaAudio, clocks: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < clocks; i++) {
    audio.clock();
    out.push(audio.level[0]);
  }
  return out;
}

/** Number of level changes in a sequence. */
const transitions = (values: number[]) => values.slice(1).filter((value, i) => value !== values[i]).length;

describe('TIA audio polynomials', () => {
  it('generates maximal-length sequences', () => {
    expect(POLY4.length).toBe(15);
    expect(POLY5.length).toBe(31);
    expect(POLY9.length).toBe(511);
    // A maximal sequence of n bits has 2^(n-1) ones.
    expect(POLY4.reduce((a, b) => a + b, 0)).toBe(8);
    expect(POLY5.reduce((a, b) => a + b, 0)).toBe(16);
    expect(POLY9.reduce((a, b) => a + b, 0)).toBe(256);
  });
});

describe('TiaAudio', () => {
  it('toggles a pure tone every AUDF+1 clocks (AUDC 4)', () => {
    const audio = new TiaAudio();
    audio.reset();
    audio.write(0, 4);
    audio.write(2, 0);
    expect(transitions(levels(audio, 100))).toBeGreaterThanOrEqual(98);
    audio.write(2, 9);
    expect(transitions(levels(audio, 100))).toBeLessThanOrEqual(11);
  });

  it('divides by three more for AUDC 12 (div 6)', () => {
    const audio = new TiaAudio();
    audio.reset();
    audio.write(0, 12);
    audio.write(2, 0);
    const count = transitions(levels(audio, 300));
    expect(count).toBeGreaterThanOrEqual(98);
    expect(count).toBeLessThanOrEqual(101);
  });

  it('outputs the volume directly in "set to 1" mode, for sample playback', () => {
    const audio = new TiaAudio();
    audio.reset();
    audio.write(0, 0);
    audio.write(4, 15);
    expect(levels(audio, 5)).toEqual([1, 1, 1, 1, 1]);
  });

  it('resamples to the output rate', () => {
    const audio = new TiaAudio();
    audio.reset();
    audio.setRates(31_400, 48_000);
    for (let i = 0; i < 31_400; i++) audio.clock();
    const samples = audio.takeSamples();
    expect(Math.abs(samples.length - 48_000)).toBeLessThanOrEqual(1);
    expect(audio.takeSamples().length).toBe(0);
  });

  it('produces a centred waveform for a tone', () => {
    const audio = new TiaAudio();
    audio.reset();
    audio.setRates(31_400, 48_000);
    audio.write(0, 4);
    audio.write(2, 15);
    audio.write(4, 8);
    for (let i = 0; i < 31_400; i++) audio.clock();
    const samples = audio.takeSamples().slice(24_000);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.max(...samples)).toBeGreaterThan(0.1);
  });
});
