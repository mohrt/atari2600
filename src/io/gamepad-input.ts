import { Dir } from './controllers/types';

/** The parts of the browser's Gamepad object we use (so tests can pass plain objects). */
export interface GamepadButtonLike {
  readonly pressed: boolean;
  readonly value: number;
}
export interface GamepadLike {
  readonly id: string;
  readonly index: number;
  readonly mapping: string;
  readonly connected?: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly GamepadButtonLike[];
}

export const BINDABLE_ACTIONS = ['up', 'down', 'left', 'right', 'fire', 'reset', 'select'] as const;
export type BindableAction = (typeof BINDABLE_ACTIONS)[number];
export const ACTION_LABELS: Record<BindableAction, string> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  fire: 'Fire',
  reset: 'Game Reset',
  select: 'Game Select',
};

type HatDirection = 'up' | 'down' | 'left' | 'right';
export type Binding =
  | { kind: 'button'; index: number }
  | { kind: 'axis'; index: number; direction: 1 | -1 }
  | { kind: 'hat'; index: number; direction: HatDirection };
export type PadBindings = Partial<Record<BindableAction, Binding>>;

/** Everything a gamepad is doing, in 2600 terms. */
export interface PadReading {
  dirs: number;
  fire: boolean;
  reset: boolean;
  select: boolean;
  /** Stick deflection from -1 to 1 (after the dead zone), for paddles and driving. */
  analogX: number;
  /** Absolute paddle positions (0 = left, 1 = right) from a paddle adapter, else null. */
  paddles: [number, number] | null;
  paddleFire: [boolean, boolean];
}

const AXIS_THRESHOLD = 0.5;
const DEAD_ZONE = 0.2;
/** Axes never go past ±1; a hat switch reads about 1.29 when centred. */
const HAT_NEUTRAL_LIMIT = 1.05;

// Standard gamepad mapping (https://w3c.github.io/gamepad/#remapping)
const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;
const BUTTON_BACK = 8;
const BUTTON_START = 9;
/** Face buttons, shoulders and triggers all fire. */
const FIRE_BUTTONS = [0, 1, 2, 3, 4, 5, 6, 7];

const HAT_STEPS = [
  Dir.Up,
  Dir.Up | Dir.Right,
  Dir.Right,
  Dir.Down | Dir.Right,
  Dir.Down,
  Dir.Down | Dir.Left,
  Dir.Left,
  Dir.Up | Dir.Left,
];
const DIR_OF: Record<HatDirection, number> = { up: Dir.Up, down: Dir.Down, left: Dir.Left, right: Dir.Right };

/**
 * Directions of a hat switch reported as one axis: eight positions from -1
 * (up) clockwise in steps of 2/7, and a value beyond ±1 when centred. Many USB
 * joysticks, arcade sticks and Atari-style adapters report their stick or
 * D-pad this way when the browser has no standard mapping for them.
 */
export function hatDirections(value: number): number {
  if (Math.abs(value) > HAT_NEUTRAL_LIMIT) return 0;
  return HAT_STEPS[Math.round((value + 1) * 3.5)] ?? 0;
}

/** USB adapters for real Atari controllers, whose two axes are a pair of paddles in paddle games. */
export function isPaddleAdapter(id: string): boolean {
  return /stelladaptor|2600-?daptor/i.test(id);
}

/** Facts learned about a pad as it is used: which axes are hat switches, which rest at zero. */
export class PadTraits {
  readonly hatAxes = new Set<number>();
  readonly restingAxes = new Set<number>();

  observe(pad: GamepadLike): void {
    pad.axes.forEach((value, index) => {
      if (Math.abs(value) > HAT_NEUTRAL_LIMIT) this.hatAxes.add(index);
      else if (Math.abs(value) < 0.1) this.restingAxes.add(index);
    });
  }
}

function deadZone(value: number): number {
  if (Math.abs(value) < DEAD_ZONE) return 0;
  return (value - Math.sign(value) * DEAD_ZONE) / (1 - DEAD_ZONE);
}

/** The usual way a pad's controls map to the joystick, for pads without custom bindings. */
function defaultDirs(pad: GamepadLike, traits: PadTraits): number {
  const pressed = (i: number) => pad.buttons[i]?.pressed ?? false;
  const axis = (i: number) => pad.axes[i] ?? 0;
  let dirs = 0;
  const standard = pad.mapping === 'standard';
  if (standard) {
    if (pressed(DPAD_UP)) dirs |= Dir.Up;
    if (pressed(DPAD_DOWN)) dirs |= Dir.Down;
    if (pressed(DPAD_LEFT)) dirs |= Dir.Left;
    if (pressed(DPAD_RIGHT)) dirs |= Dir.Right;
  }
  // The left stick (on a plain joystick, its only stick).
  if (!traits.hatAxes.has(0) && !traits.hatAxes.has(1)) dirs |= axisPairDirs(axis(0), axis(1));
  if (!standard) {
    for (const index of traits.hatAxes) dirs |= hatDirections(axis(index));
    // Some browsers report a D-pad as axes 6 and 7; triggers never rest at zero, so they're left out.
    if (traits.restingAxes.has(6) && traits.restingAxes.has(7) && !traits.hatAxes.has(6)) {
      dirs |= axisPairDirs(axis(6), axis(7));
    }
  }
  return dirs;
}

function axisPairDirs(x: number, y: number): number {
  let dirs = 0;
  if (y < -AXIS_THRESHOLD) dirs |= Dir.Up;
  if (y > AXIS_THRESHOLD) dirs |= Dir.Down;
  if (x < -AXIS_THRESHOLD) dirs |= Dir.Left;
  if (x > AXIS_THRESHOLD) dirs |= Dir.Right;
  return dirs;
}

function bindingActive(pad: GamepadLike, binding: Binding): boolean {
  switch (binding.kind) {
    case 'button':
      return pad.buttons[binding.index]?.pressed ?? false;
    case 'axis':
      return (pad.axes[binding.index] ?? 0) * binding.direction > AXIS_THRESHOLD;
    case 'hat':
      return (hatDirections(pad.axes[binding.index] ?? 2) & DIR_OF[binding.direction]) !== 0;
  }
}

/** Reads a pad, using its custom bindings where it has them and the usual mapping elsewhere. */
export function readGamepad(pad: GamepadLike, traits: PadTraits, bindings: PadBindings = {}): PadReading {
  traits.observe(pad);
  const pressed = (i: number) => pad.buttons[i]?.pressed ?? false;
  const fallbackDirs = defaultDirs(pad, traits);
  let dirs = 0;
  for (const action of ['up', 'down', 'left', 'right'] as const) {
    const binding = bindings[action];
    const active = binding ? bindingActive(pad, binding) : (fallbackDirs & DIR_OF[action]) !== 0;
    if (active) dirs |= DIR_OF[action];
  }
  const action = (name: 'fire' | 'reset' | 'select', fallback: () => boolean) => {
    const binding = bindings[name];
    return binding ? bindingActive(pad, binding) : fallback();
  };

  // Analog turning comes from the axis bound to left/right, or the main stick.
  const horizontal = bindings.right ?? bindings.left;
  const analogAxis = horizontal?.kind === 'axis' ? horizontal.index : traits.hatAxes.has(0) ? -1 : 0;
  let analogSign = 1;
  if (horizontal?.kind === 'axis') analogSign = horizontal === bindings.right ? horizontal.direction : -horizontal.direction;
  const analogX = analogAxis >= 0 ? deadZone(pad.axes[analogAxis] ?? 0) * analogSign : 0;

  const adapter = isPaddleAdapter(pad.id);
  return {
    dirs,
    fire: action('fire', () => FIRE_BUTTONS.some(pressed)),
    reset: action('reset', () => pressed(BUTTON_START)),
    select: action('select', () => pressed(BUTTON_BACK)),
    analogX,
    paddles: adapter ? [((pad.axes[0] ?? 0) + 1) / 2, ((pad.axes[1] ?? 0) + 1) / 2] : null,
    paddleFire: adapter ? [pressed(0), pressed(1)] : [false, false],
  };
}

// --- Assigning pads to players -------------------------------------------------------

/** A player's gamepad: the next free one ('auto'), none ('off'), or a particular pad by its id. */
export type PadChoice = 'auto' | 'off' | `id:${string}`;

export const MAX_PLAYERS = 4;

/**
 * Tracks connected gamepads (including ones plugged in or out while
 * playing) and which player each one drives. Pads chosen by name stay with
 * their player across reconnects; the rest go to 'auto' players in the order
 * they were connected.
 */
export class GamepadManager {
  readonly choices: PadChoice[] = Array(MAX_PLAYERS).fill('auto');
  onChange: () => void = () => {};
  private readonly connectOrder: number[] = [];
  private readonly traits = new Map<string, PadTraits>();

  constructor(private readonly source: () => readonly (GamepadLike | null)[] = browserGamepads) {}

  attach(target: Window): void {
    target.addEventListener('gamepadconnected', (event) => {
      this.noteConnected((event as GamepadEvent).gamepad.index);
      this.onChange();
    });
    target.addEventListener('gamepaddisconnected', (event) => {
      const at = this.connectOrder.indexOf((event as GamepadEvent).gamepad.index);
      if (at >= 0) this.connectOrder.splice(at, 1);
      this.onChange();
    });
  }

  private noteConnected(index: number): void {
    if (!this.connectOrder.includes(index)) this.connectOrder.push(index);
  }

  /** Connected pads, in the order they were plugged in. */
  connected(): GamepadLike[] {
    const pads = [...this.source()].filter((pad): pad is GamepadLike => pad !== null && pad.connected !== false);
    for (const pad of pads) this.noteConnected(pad.index);
    const rank = (pad: GamepadLike) => this.connectOrder.indexOf(pad.index);
    return pads.sort((a, b) => rank(a) - rank(b));
  }

  /** The pad driving `player` (0-3), if any. */
  padFor(player: number, pads: GamepadLike[] = this.connected()): GamepadLike | null {
    const taken = new Set<GamepadLike>();
    const assigned: (GamepadLike | null)[] = Array(MAX_PLAYERS).fill(null);
    // Pads chosen by name first, then share out the rest among the 'auto' players.
    this.choices.forEach((choice, p) => {
      if (!choice.startsWith('id:')) return;
      const pad = pads.find((candidate) => `id:${candidate.id}` === choice && !taken.has(candidate)) ?? null;
      if (pad) taken.add(pad);
      assigned[p] = pad;
    });
    const free = pads.filter((pad) => !taken.has(pad));
    this.choices.forEach((choice, p) => {
      if (choice === 'auto') assigned[p] = free.shift() ?? null;
    });
    return assigned[player];
  }

  traitsFor(pad: GamepadLike): PadTraits {
    const key = `${pad.index}:${pad.id}`;
    let traits = this.traits.get(key);
    if (!traits) {
      traits = new PadTraits();
      this.traits.set(key, traits);
    }
    return traits;
  }

  read(player: number, bindingsFor: (id: string) => PadBindings, pads?: GamepadLike[]): PadReading | null {
    const pad = this.padFor(player, pads);
    return pad ? readGamepad(pad, this.traitsFor(pad), bindingsFor(pad.id)) : null;
  }
}

function browserGamepads(): readonly (GamepadLike | null)[] {
  try {
    return navigator.getGamepads?.() ?? [];
  } catch {
    // Blocked by a permissions policy.
    return [];
  }
}

/** A short, readable name for a pad (browsers add vendor and product codes). */
export function padName(pad: GamepadLike): string {
  return pad.id.replace(/\s*\((?:standard gamepad\s*)?vendor:.*\)\s*$/i, '').replace(/\s*\(.*\)\s*$/, '').trim() || 'Gamepad';
}

// --- Remapping ---------------------------------------------------------------------

interface Snapshot {
  buttons: boolean[];
  axes: number[];
}

function snapshot(pad: GamepadLike): Snapshot {
  return { buttons: pad.buttons.map((button) => button.pressed), axes: [...pad.axes] };
}

/** True once the pad is back where it started (nothing newly pressed, sticks centred). */
function atRest(pad: GamepadLike, baseline: Snapshot): boolean {
  if (pad.buttons.some((button, i) => button.pressed && !baseline.buttons[i])) return false;
  return pad.axes.every((value, i) => {
    const base = baseline.axes[i] ?? 0;
    if (Math.abs(base) > HAT_NEUTRAL_LIMIT) return Math.abs(value) > HAT_NEUTRAL_LIMIT;
    return Math.abs(value - base) < 0.3;
  });
}

/** The first control that moved away from the baseline, as a binding for `action`. */
export function detectBinding(pad: GamepadLike, baseline: Snapshot, action: BindableAction): Binding | null {
  const button = pad.buttons.findIndex((b, i) => b.pressed && !baseline.buttons[i]);
  if (button >= 0) return { kind: 'button', index: button };
  for (let index = 0; index < pad.axes.length; index++) {
    const value = pad.axes[index];
    const base = baseline.axes[index] ?? 0;
    if (Math.abs(base) > HAT_NEUTRAL_LIMIT) {
      const dirs = hatDirections(value);
      if (!dirs) continue;
      const wanted = (DIR_OF as Record<string, number>)[action];
      const direction =
        wanted && dirs & wanted
          ? (action as HatDirection)
          : (['up', 'down', 'left', 'right'] as const).find((name) => dirs & DIR_OF[name])!;
      return { kind: 'hat', index, direction };
    }
    if (Math.abs(value - base) > 0.6 && Math.abs(value) > AXIS_THRESHOLD) {
      return { kind: 'axis', index, direction: value > 0 ? 1 : -1 };
    }
  }
  return null;
}

/**
 * Press-to-bind: asks for each action in turn and records the first button,
 * axis or hat direction that moves. Call `poll` once per frame.
 */
export class BindingCapture {
  readonly bindings: PadBindings = {};
  private step = 0;
  private baseline: Snapshot;
  private waitingForRelease = true;

  constructor(
    private readonly pad: () => GamepadLike | null,
    initial: GamepadLike,
    private readonly onPrompt: (action: BindableAction | null) => void,
  ) {
    this.baseline = snapshot(initial);
    onPrompt(BINDABLE_ACTIONS[0]);
  }

  get action(): BindableAction | null {
    return BINDABLE_ACTIONS[this.step] ?? null;
  }

  /** Leaves the current action on its usual control. */
  skip(): void {
    this.advance();
  }

  poll(): void {
    const pad = this.pad();
    const action = this.action;
    if (!pad || !action) return;
    if (this.waitingForRelease) {
      if (atRest(pad, this.baseline)) this.waitingForRelease = false;
      return;
    }
    const binding = detectBinding(pad, this.baseline, action);
    if (!binding) return;
    this.bindings[action] = binding;
    this.advance();
  }

  private advance(): void {
    this.step++;
    this.waitingForRelease = true;
    this.onPrompt(this.action);
  }
}

/** How a binding reads, e.g. "button 3", "axis 1 −", "hat 9 up". */
export function describeBinding(binding: Binding): string {
  switch (binding.kind) {
    case 'button':
      return `button ${binding.index}`;
    case 'axis':
      return `axis ${binding.index} ${binding.direction > 0 ? '+' : '−'}`;
    case 'hat':
      return `hat ${binding.index} ${binding.direction}`;
  }
}

/** One line per connected pad: who it drives and what is pressed, for the controls panel. */
export function describeGamepads(manager: GamepadManager, bindingsFor: (id: string) => PadBindings): string[] {
  const pads = manager.connected();
  const playerOf = new Map<GamepadLike, number>();
  for (let player = 0; player < MAX_PLAYERS; player++) {
    const pad = manager.padFor(player, pads);
    if (pad) playerOf.set(pad, player);
  }
  return pads.map((pad) => {
    const reading = readGamepad(pad, manager.traitsFor(pad), bindingsFor(pad.id));
    const pressed = [
      reading.dirs & Dir.Up ? 'up' : '',
      reading.dirs & Dir.Down ? 'down' : '',
      reading.dirs & Dir.Left ? 'left' : '',
      reading.dirs & Dir.Right ? 'right' : '',
      reading.fire ? 'FIRE' : '',
      reading.reset ? 'RESET' : '',
      reading.select ? 'SELECT' : '',
      ...pad.buttons.flatMap((button, i) => (button.pressed ? [`button ${i}`] : [])),
      ...pad.axes.flatMap((value, i) => (Math.abs(value) > 0.3 && Math.abs(value) <= HAT_NEUTRAL_LIMIT ? [`axis ${i} ${value.toFixed(2)}`] : [])),
    ].filter(Boolean);
    const player = playerOf.get(pad);
    const who = player === undefined ? 'not in use' : `player ${player + 1}`;
    const kind = pad.mapping === 'standard' ? '' : ', generic';
    return `${padName(pad)} (${who}${kind}): ${pressed.length ? pressed.join(', ') : 'nothing pressed'}`;
  });
}
