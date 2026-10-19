import type { TvStandard } from '../atari2600';
import type { FrameInfo } from '../tia/tia';

/** Lines shown on screen, and where the window sits when a game gives no hint. */
export const WINDOW_LINES: Record<TvStandard, number> = { ntsc: 216, pal: 256, secam: 256 };
const DEFAULT_TOP: Record<TvStandard, number> = { ntsc: 28, pal: 34, secam: 34 };
/** Width of a TIA pixel relative to its height, so the picture has a TV's proportions. */
export const PIXEL_ASPECT: Record<TvStandard, number> = { ntsc: 1.8, pal: 2.1, secam: 2.1 };

/** A new window position must hold for this many frames before the picture moves. */
const SETTLE_FRAMES = 4;

/**
 * Chooses which lines of each frame are shown: the lines with VBLANK off,
 * centred in a fixed-height window. The position only follows a change once
 * it has held for a few frames, so a game whose line counts wobble (or that
 * skips a frame while loading) doesn't make the picture jump.
 */
export class FrameWindow {
  top: number;
  private candidate = -1;
  private candidateFrames = 0;
  private settled = false;

  constructor(private tv: TvStandard = 'ntsc') {
    this.top = DEFAULT_TOP[tv];
  }

  get lines(): number {
    return WINDOW_LINES[this.tv];
  }

  setTv(tv: TvStandard): void {
    this.tv = tv;
    this.reset();
  }

  /** Forget the current position (e.g. for a new cartridge). */
  reset(): void {
    this.top = DEFAULT_TOP[this.tv];
    this.candidate = -1;
    this.candidateFrames = 0;
    this.settled = false;
  }

  update(info: FrameInfo): void {
    const wanted = this.wantedTop(info);
    if (wanted === null) return;
    if (!this.settled) {
      // Follow the first real picture straight away.
      this.top = wanted;
      this.settled = true;
      return;
    }
    if (wanted === this.top) {
      this.candidateFrames = 0;
      return;
    }
    if (wanted !== this.candidate) {
      this.candidate = wanted;
      this.candidateFrames = 0;
    }
    if (++this.candidateFrames >= SETTLE_FRAMES) {
      this.top = wanted;
      this.candidateFrames = 0;
    }
  }

  private wantedTop(info: FrameInfo): number | null {
    const height = this.lines;
    if (info.firstVisible < 0 || !info.synced) return null;
    const visible = info.lastVisible - info.firstVisible + 1;
    // Games that never use VBLANK light every line; keep the usual position for those.
    if (visible > height || info.firstVisible < 8) return DEFAULT_TOP[this.tv];
    return Math.max(0, info.firstVisible - Math.floor((height - visible) / 2));
  }
}

/** Frames longer than this many lines are PAL (or SECAM). */
const PAL_LINE_THRESHOLD = 287;
const DETECT_FRAMES = 30;

/**
 * Works out the TV standard a game was written for from its frame length:
 * NTSC games draw about 262 lines per frame, PAL and SECAM games about 312.
 */
export class TvDetector {
  private readonly history: boolean[] = [];

  reset(): void {
    this.history.length = 0;
  }

  /** Returns the detected standard once enough frames have been seen, else null. */
  update(info: FrameInfo): 'ntsc' | 'pal' | null {
    if (!info.synced) return null;
    this.history.push(info.lines > PAL_LINE_THRESHOLD);
    if (this.history.length > DETECT_FRAMES) this.history.shift();
    if (this.history.length < DETECT_FRAMES) return null;
    const pal = this.history.filter(Boolean).length;
    return pal > DETECT_FRAMES / 2 ? 'pal' : 'ntsc';
  }
}
