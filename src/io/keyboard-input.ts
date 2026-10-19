import type { ControllerPorts } from './controllers/ports';
import { Dir } from './controllers/types';

/** Very short taps are held this long, so a game polling once per frame still sees them. */
export const MIN_KEY_HOLD_MS = 50;

interface KeyAction {
  dirs?: number;
  fire?: boolean;
}

const { Up, Down, Left, Right } = Dir;

/** Keys that work a joystick (or turn paddles and driving controllers). */
export const KEY_SETS = {
  arrows: {
    ArrowUp: { dirs: Up },
    ArrowDown: { dirs: Down },
    ArrowLeft: { dirs: Left },
    ArrowRight: { dirs: Right },
    Space: { fire: true },
  },
  wasd: {
    KeyW: { dirs: Up },
    KeyS: { dirs: Down },
    KeyA: { dirs: Left },
    KeyD: { dirs: Right },
    KeyF: { fire: true },
  },
  numpad: {
    Numpad8: { dirs: Up },
    Numpad2: { dirs: Down },
    Numpad4: { dirs: Left },
    Numpad6: { dirs: Right },
    Numpad7: { dirs: Up | Left },
    Numpad9: { dirs: Up | Right },
    Numpad1: { dirs: Down | Left },
    Numpad3: { dirs: Down | Right },
    Numpad0: { fire: true },
    Numpad5: { fire: true },
  },
} satisfies Record<string, Record<string, KeyAction>>;
export type KeySetName = keyof typeof KEY_SETS;

export function isKeySetName(value: unknown): value is KeySetName {
  return typeof value === 'string' && value in KEY_SETS;
}

/** Keypad controllers: a 3x4 block of keys on each side of the keyboard (keys 1 2 3 / 4 5 6 / 7 8 9 / * 0 #). */
export const KEYPAD_KEYS: [string[], string[]] = [
  ['Digit1', 'Digit2', 'Digit3', 'KeyQ', 'KeyW', 'KeyE', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyX', 'KeyC'],
  ['Digit8', 'Digit9', 'Digit0', 'KeyI', 'KeyO', 'KeyP', 'KeyK', 'KeyL', 'Semicolon', 'Comma', 'Period', 'Slash'],
];

/** F1-F8, as in Stella: Select, Reset, Colour, B/W, left difficulty A/B, right difficulty A/B. */
const CONSOLE_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'];

export interface KeyboardCallbacks {
  /** A toggle switch changed from the keyboard (so the page can show it). */
  onSwitchesChanged(): void;
  onPause(): void;
}

function isFormField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
}

/**
 * Turns key presses into joystick moves for players 1 and 2, keypad presses,
 * and the console switches. Each player can use one of the key sets.
 */
export class KeyboardInput {
  readonly playerKeys: (KeySetName | null)[] = ['arrows', null];
  private readonly held = new Set<string>();
  private readonly pressedAt = new Map<string, number>();
  private readonly pendingReleases = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly ports: ControllerPorts,
    private readonly callbacks: KeyboardCallbacks,
  ) {}

  attach(target: Window): void {
    target.addEventListener('keydown', (event) => this.onKey(event, true));
    target.addEventListener('keyup', (event) => this.onKey(event, false));
    target.addEventListener('blur', () => this.releaseAll());
  }

  setPlayerKeys(player: 0 | 1, keys: KeySetName | null): void {
    this.playerKeys[player] = keys;
    this.update();
  }

  /** Whether a key does something in the current setup. */
  private handles(code: string): boolean {
    if (CONSOLE_KEYS.includes(code) || code === 'Pause') return true;
    for (const port of [0, 1] as const) {
      if (this.ports.types[port] === 'keypad' && KEYPAD_KEYS[port].includes(code)) return true;
    }
    return this.playerKeys.some((set) => set !== null && code in KEY_SETS[set]);
  }

  private onKey(event: KeyboardEvent, down: boolean): void {
    if (isFormField(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    const code = event.code;
    if (!this.handles(code)) return;
    event.preventDefault();
    if (down) {
      if (event.repeat) return;
      this.onToggleKey(code);
      clearTimeout(this.pendingReleases.get(code));
      this.pendingReleases.delete(code);
      this.held.add(code);
      this.pressedAt.set(code, performance.now());
      this.update();
      return;
    }
    const remaining = MIN_KEY_HOLD_MS - (performance.now() - (this.pressedAt.get(code) ?? 0));
    if (remaining > 0) {
      this.pendingReleases.set(code, setTimeout(() => this.release(code), remaining));
    } else {
      this.release(code);
    }
  }

  private onToggleKey(code: string): void {
    const switches = this.ports.switches;
    const toggles: Record<string, () => void> = {
      F3: () => (switches.color = true),
      F4: () => (switches.color = false),
      F5: () => (switches.leftDifficultyA = true),
      F6: () => (switches.leftDifficultyA = false),
      F7: () => (switches.rightDifficultyA = true),
      F8: () => (switches.rightDifficultyA = false),
    };
    if (code === 'Pause') this.callbacks.onPause();
    const toggle = toggles[code];
    if (toggle) {
      toggle();
      this.callbacks.onSwitchesChanged();
    }
  }

  private release(code: string): void {
    this.pendingReleases.delete(code);
    this.held.delete(code);
    this.update();
  }

  releaseAll(): void {
    this.pendingReleases.forEach((timer) => clearTimeout(timer));
    this.pendingReleases.clear();
    this.held.clear();
    this.update();
  }

  private update(): void {
    const keypadCodes = new Set<string>();
    for (const player of [0, 1] as const) {
      let keypad = 0;
      if (this.ports.types[player] === 'keypad') {
        KEYPAD_KEYS[player].forEach((code, key) => {
          keypadCodes.add(code);
          if (this.held.has(code)) keypad |= 1 << key;
        });
      }
      let dirs = 0;
      let fire = false;
      const set = this.playerKeys[player];
      if (set) {
        const actions: Record<string, KeyAction> = KEY_SETS[set];
        for (const code of this.held) {
          const action = actions[code];
          if (!action || keypadCodes.has(code)) continue;
          dirs |= action.dirs ?? 0;
          fire ||= action.fire ?? false;
        }
      }
      this.ports.players[player].set('keyboard', { dirs, fire, keypad });
    }
    this.ports.switches.buttons.set('keyboard', this.held.has('F2'), this.held.has('F1'));
  }
}
