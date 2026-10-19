import type { TvStandard } from '../atari2600';
import { VISIBLE_WIDTH } from '../tia/tia';
import { PALETTES } from './palette';

/**
 * Turns finished TIA frames (colour indexes) into canvas pixels. With
 * phosphor on, each frame is averaged with the one before, as a TV's glow
 * does, so sprites a game flickers on alternate frames look solid.
 */
export class Screen {
  private readonly context: CanvasRenderingContext2D;
  private image!: ImageData;
  private pixels!: Uint32Array;
  private previous!: Uint32Array;
  private palette: Uint32Array = PALETTES.ntsc;
  private hasNewFrame = false;
  phosphor = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    lines: number,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is not available');
    this.context = context;
    this.resize(lines);
  }

  get lines(): number {
    return this.canvas.height;
  }

  setTv(tv: TvStandard): void {
    this.palette = PALETTES[tv];
  }

  resize(lines: number): void {
    this.canvas.width = VISIBLE_WIDTH;
    this.canvas.height = lines;
    this.image = this.context.createImageData(VISIBLE_WIDTH, lines);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.previous = new Uint32Array(this.pixels.length);
  }

  /** Copies `lines` lines of a frame, starting at `top`, so a half-drawn frame is never shown. */
  capture(frame: Uint8Array, frameLines: number, top: number): void {
    const { pixels, previous, palette } = this;
    const total = pixels.length;
    for (let i = 0, src = top * VISIBLE_WIDTH; i < total; i++, src++) {
      const line = (src / VISIBLE_WIDTH) | 0;
      const color = line < frameLines ? palette[frame[src]] : palette[0];
      if (this.phosphor) {
        const before = previous[i];
        pixels[i] = ((((color & 0xfefefe) >>> 1) + ((before & 0xfefefe) >>> 1)) | 0xff000000) >>> 0;
      } else {
        pixels[i] = color;
      }
      previous[i] = color;
    }
    this.hasNewFrame = true;
  }

  /** TV snow, shown while no cartridge is in. */
  showSnow(): void {
    const { pixels } = this;
    for (let i = 0; i < pixels.length; i++) {
      const level = (Math.random() * 200) | 0;
      pixels[i] = (0xff000000 | (level << 16) | (level << 8) | level) >>> 0;
    }
    this.hasNewFrame = true;
  }

  present(): void {
    if (!this.hasNewFrame) return;
    this.context.putImageData(this.image, 0, 0);
    this.hasNewFrame = false;
  }
}
