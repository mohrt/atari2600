import { Atari2600, type TvStandard } from './atari2600';
import type { Cartridge } from './cart/cartridge';
import { FrameWindow, TvDetector } from './render/frame-window';
import type { Screen } from './render/screen';
import type { FrameInfo } from './tia/tia';

export type TvSetting = 'auto' | TvStandard;

/** Longest gap we catch up on, so a backgrounded tab doesn't run a burst of frames. */
const MAX_CATCH_UP_MS = 100;

/**
 * Glues the machine to the screen: picks the visible window of each frame,
 * follows the TV standard (detected from the game's frame length in Auto),
 * and runs the machine in step with real time.
 */
export class Emulator {
  readonly machine = new Atari2600();
  readonly window = new FrameWindow('ntsc');
  private readonly detector = new TvDetector();
  tvSetting: TvSetting = 'auto';
  /** Called when the TV standard in use changes (after detection or a setting change). */
  onTvChange: (tv: TvStandard) => void = () => {};
  /** Called for each finished frame, before it is shown. */
  onFrame: (info: FrameInfo) => void = () => {};
  private cycleDebt = 0;
  private audioRate = 48000;

  constructor(private readonly screen: Screen) {
    this.machine.tia.onFrame = (pixels, info) => this.frameDone(pixels, info);
  }

  get hasCartridge(): boolean {
    return this.machine.cartridge !== null;
  }

  setAudioRate(rate: number): void {
    this.audioRate = rate;
    this.updateAudioRate();
  }

  insertCartridge(cartridge: Cartridge | null): void {
    this.machine.insertCartridge(cartridge);
    this.detector.reset();
    this.window.reset();
    this.cycleDebt = 0;
    if (this.tvSetting === 'auto') this.useTv('ntsc');
  }

  setTvSetting(setting: TvSetting): void {
    this.tvSetting = setting;
    this.detector.reset();
    if (setting !== 'auto') this.useTv(setting);
  }

  /** Applies the standard of a restored save state. */
  restoredTv(tv: TvStandard): void {
    this.detector.reset();
    this.useTv(tv, true);
  }

  private useTv(tv: TvStandard, force = false): void {
    if (tv === this.machine.tv && !force) return;
    this.machine.setTv(tv);
    this.window.setTv(tv);
    this.screen.setTv(tv);
    if (this.screen.lines !== this.window.lines) this.screen.resize(this.window.lines);
    this.updateAudioRate();
    this.onTvChange(tv);
  }

  private updateAudioRate(): void {
    this.machine.tia.audio.setRates(this.machine.audioClockHz, this.audioRate);
  }

  /** Runs the machine for `elapsedMs` of real time (no more than MAX_CATCH_UP_MS). */
  run(elapsedMs: number): void {
    if (!this.hasCartridge) {
      this.screen.showSnow();
      return;
    }
    this.cycleDebt += (Math.min(elapsedMs, MAX_CATCH_UP_MS) * this.machine.clockHz) / 1000;
    if (this.cycleDebt > 0) this.cycleDebt -= this.machine.runCycles(this.cycleDebt);
  }

  /** Runs exactly one frame (frame advance while paused). */
  stepFrame(): void {
    if (this.hasCartridge) this.machine.runFrame();
  }

  /** Forgets accumulated time, e.g. after a pause. */
  resetTiming(): void {
    this.cycleDebt = 0;
  }

  takeAudioSamples(): Float32Array {
    return this.machine.tia.audio.takeSamples();
  }

  private frameDone(pixels: Uint8Array, info: FrameInfo): void {
    if (this.tvSetting === 'auto') {
      const detected = this.detector.update(info);
      if (detected && detected !== this.machine.tv) this.useTv(detected);
    }
    this.window.update(info);
    this.onFrame(info);
    this.screen.capture(pixels, info.lines, this.window.top);
  }
}
