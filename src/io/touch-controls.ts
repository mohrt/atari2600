import type { ConsoleButtons, PlayerInput } from './player-input';
import { Dir, KEYPAD_LABELS, type ControllerType } from './controllers/types';

/** Inside this fraction of the stick's radius, no direction is pressed. */
const STICK_DEAD_ZONE = 0.25;
/** Dragging across the whole paddle strip turns the paddle this far (as a fraction of a full turn). */
const STRIP_TURNS = 1.2;

function requireChild<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Touch controls are missing ${selector}`);
  return element;
}

/** Eight-way directions for a stick pushed by (dx, dy), relative to its radius. */
export function stickDirections(dx: number, dy: number): number {
  if (Math.hypot(dx, dy) < STICK_DEAD_ZONE) return 0;
  // Sectors of 45 degrees, centred on each direction.
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  const bySector: Record<number, number> = {
    0: Dir.Right,
    1: Dir.Down | Dir.Right,
    2: Dir.Down,
    3: Dir.Down | Dir.Left,
    4: Dir.Left,
    [-4]: Dir.Left,
    [-3]: Dir.Up | Dir.Left,
    [-2]: Dir.Up,
    [-1]: Dir.Up | Dir.Right,
  };
  return bySector[sector] ?? 0;
}

/** Calls `onDown`/`onUp` for one pointer at a time on an element (so other fingers stay free). */
function trackPointer(
  element: HTMLElement,
  handlers: { down(event: PointerEvent): void; move?(event: PointerEvent): void; up(): void },
): void {
  let active: number | null = null;
  element.addEventListener('pointerdown', (event) => {
    if (active !== null) return;
    active = event.pointerId;
    element.setPointerCapture(event.pointerId);
    element.classList.add('active');
    event.preventDefault();
    handlers.down(event);
  });
  element.addEventListener('pointermove', (event) => {
    if (event.pointerId === active) handlers.move?.(event);
  });
  const end = (event: PointerEvent) => {
    if (event.pointerId !== active) return;
    active = null;
    element.classList.remove('active');
    handlers.up();
  };
  element.addEventListener('pointerup', end);
  element.addEventListener('pointercancel', end);
}

/**
 * On-screen controls for phones and tablets, driving player 1: a joystick
 * (or a strip to turn paddles, or a keypad), a fire button and the Select
 * and Reset switches. Several fingers can be used at once.
 */
export class TouchControls {
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly keypad: HTMLElement;
  private readonly state = { dirs: 0, fire: false, keypad: 0 };
  private readonly console = { reset: false, select: false };

  constructor(
    private readonly root: HTMLElement,
    private readonly player: PlayerInput,
    private readonly consoleButtons: ConsoleButtons,
  ) {
    this.stick = requireChild(root, '.touch-stick');
    this.knob = requireChild(root, '.touch-knob');
    this.strip = requireChild(root, '.touch-strip');
    this.keypad = requireChild(root, '.touch-keypad');
    this.attachStick();
    this.attachStrip();
    this.attachKeypad();
    this.attachButton(requireChild(root, '[data-touch="fire"]'), (down) => {
      this.state.fire = down;
      if (down) navigator.vibrate?.(8);
      this.push();
    });
    this.attachButton(requireChild(root, '[data-touch="reset"]'), (down) => this.pushConsole('reset', down));
    this.attachButton(requireChild(root, '[data-touch="select"]'), (down) => this.pushConsole('select', down));
    // Stop the page from scrolling or zooming under the controls.
    root.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
    root.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /** Shows the right control for player 1's controller. */
  setController(type: ControllerType): void {
    this.root.dataset.controller = type;
  }

  private attachStick(): void {
    const update = (event: PointerEvent) => {
      const rect = this.stick.getBoundingClientRect();
      const radius = rect.width / 2;
      let dx = (event.clientX - (rect.left + radius)) / radius;
      let dy = (event.clientY - (rect.top + radius)) / radius;
      const length = Math.hypot(dx, dy);
      if (length > 1) {
        dx /= length;
        dy /= length;
      }
      this.knob.style.transform = `translate(${dx * 50}%, ${dy * 50}%)`;
      this.state.dirs = stickDirections(dx, dy);
      this.push();
    };
    trackPointer(this.stick, {
      down: update,
      move: update,
      up: () => {
        this.knob.style.transform = '';
        this.state.dirs = 0;
        this.push();
      },
    });
  }

  private attachStrip(): void {
    let lastX = 0;
    trackPointer(this.strip, {
      down: (event) => (lastX = event.clientX),
      move: (event) => {
        const width = this.strip.getBoundingClientRect().width || 1;
        this.player.addPaddleDelta(((event.clientX - lastX) / width) * STRIP_TURNS);
        lastX = event.clientX;
      },
      up: () => {},
    });
  }

  private attachKeypad(): void {
    KEYPAD_LABELS.forEach((label, key) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      this.keypad.append(button);
      this.attachButton(button, (down) => {
        this.state.keypad = down ? this.state.keypad | (1 << key) : this.state.keypad & ~(1 << key);
        this.push();
      });
    });
  }

  private attachButton(button: HTMLElement, onChange: (down: boolean) => void): void {
    trackPointer(button, { down: () => onChange(true), up: () => onChange(false) });
  }

  private push(): void {
    this.player.set('touch', { ...this.state });
  }

  private pushConsole(which: 'reset' | 'select', down: boolean): void {
    this.console[which] = down;
    this.consoleButtons.set('touch', this.console.reset, this.console.select);
  }
}
