import type { PlayerInput } from './player-input';

/** Mouse movement (in pixels) for a full turn of the paddle. */
const PIXELS_PER_TURN = 700;

/**
 * Uses the mouse as player 1's paddle: click the screen to capture the
 * pointer, move left and right to turn, click to fire. Esc lets go.
 */
export class MousePaddle {
  private enabled = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly player: PlayerInput,
  ) {
    canvas.addEventListener('click', () => {
      if (this.enabled && document.pointerLockElement !== canvas) void canvas.requestPointerLock?.();
    });
    document.addEventListener('mousemove', (event) => {
      if (this.captured) this.player.addPaddleDelta(event.movementX / PIXELS_PER_TURN);
    });
    document.addEventListener('mousedown', (event) => {
      if (this.captured && event.button === 0) this.player.set('mouse', { fire: true });
    });
    document.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.player.clear('mouse');
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.captured) this.player.clear('mouse');
    });
  }

  private get captured(): boolean {
    return this.enabled && document.pointerLockElement === this.canvas;
  }

  /** On while a paddle game is in; turning it off lets go of the pointer. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}
