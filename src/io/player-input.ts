/** What one input source (keyboard, a gamepad, touch, the mouse) is doing for a player. */
export interface SourceState {
  /** Held directions (Dir bits). */
  dirs?: number;
  fire?: boolean;
  /** Stick deflection from -1 (left) to 1 (right), for turning paddles and driving controllers. */
  analogX?: number;
  /** An absolute paddle position from 0 (fully left) to 1 (fully right), e.g. from a real paddle. */
  paddle?: number;
  /** Held keypad keys (bit n = key n). */
  keypad?: number;
}

/**
 * Everything one player is doing, combined from all the sources driving
 * them, like several switches wired in parallel.
 */
export class PlayerInput {
  private readonly sources = new Map<string, SourceState>();
  private paddleSource: string | null = null;
  private paddleDelta = 0;

  set(source: string, state: SourceState): void {
    const before = this.sources.get(source);
    if (state.paddle !== undefined && state.paddle !== before?.paddle) this.paddleSource = source;
    this.sources.set(source, state);
  }

  clear(source: string): void {
    this.sources.delete(source);
    if (this.paddleSource === source) this.paddleSource = null;
  }

  /** Adds relative paddle movement (e.g. from the mouse), as a fraction of the full turn. */
  addPaddleDelta(delta: number): void {
    this.paddleDelta += delta;
    this.paddleSource = null;
  }

  get dirs(): number {
    let dirs = 0;
    for (const state of this.sources.values()) dirs |= state.dirs ?? 0;
    return dirs;
  }

  get fire(): boolean {
    for (const state of this.sources.values()) if (state.fire) return true;
    return false;
  }

  /** The strongest stick deflection among the sources. */
  get analogX(): number {
    let strongest = 0;
    for (const state of this.sources.values()) {
      const x = state.analogX ?? 0;
      if (Math.abs(x) > Math.abs(strongest)) strongest = x;
    }
    return strongest;
  }

  get keypad(): number {
    let keys = 0;
    for (const state of this.sources.values()) keys |= state.keypad ?? 0;
    return keys;
  }

  /** The position from the source that last moved an absolute paddle, or null. */
  get absolutePaddle(): number | null {
    if (this.paddleSource === null) return null;
    return this.sources.get(this.paddleSource)?.paddle ?? null;
  }

  /** Relative movement since the last call. */
  takePaddleDelta(): number {
    const delta = this.paddleDelta;
    this.paddleDelta = 0;
    return delta;
  }
}

/** Momentary console switches from all sources (keys, gamepads, buttons, touch). */
export class ConsoleButtons {
  private readonly sources = new Map<string, { reset: boolean; select: boolean }>();

  set(source: string, reset: boolean, select: boolean): void {
    if (reset || select) this.sources.set(source, { reset, select });
    else this.sources.delete(source);
  }

  get reset(): boolean {
    for (const state of this.sources.values()) if (state.reset) return true;
    return false;
  }

  get select(): boolean {
    for (const state of this.sources.values()) if (state.select) return true;
    return false;
  }
}
