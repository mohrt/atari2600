import { describe, expect, it } from 'vitest';
import { Dir } from '../src/io/controllers/types';
import {
  BindingCapture,
  GamepadManager,
  PadTraits,
  detectBinding,
  hatDirections,
  readGamepad,
  type GamepadLike,
} from '../src/io/gamepad-input';

interface FakePad extends GamepadLike {
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}

function pad(options: { id?: string; index?: number; mapping?: string; axes?: number; buttons?: number } = {}): FakePad {
  return {
    id: options.id ?? 'Test pad',
    index: options.index ?? 0,
    mapping: options.mapping ?? 'standard',
    connected: true,
    axes: Array(options.axes ?? 4).fill(0),
    buttons: Array.from({ length: options.buttons ?? 17 }, () => ({ pressed: false, value: 0 })),
  };
}

const press = (p: FakePad, i: number, down = true) => (p.buttons[i] = { pressed: down, value: down ? 1 : 0 });
const HAT_CENTRED = 9 / 7;

describe('standard gamepads', () => {
  it('reads the D-pad, left stick, face buttons, Start and Back', () => {
    const p = pad();
    const traits = new PadTraits();
    press(p, 12);
    p.axes[0] = 0.9;
    press(p, 0);
    press(p, 9);
    press(p, 8);
    const reading = readGamepad(p, traits);
    expect(reading.dirs).toBe(Dir.Up | Dir.Right);
    expect(reading.fire).toBe(true);
    expect(reading.reset).toBe(true);
    expect(reading.select).toBe(true);
    expect(reading.analogX).toBeGreaterThan(0.8);
  });

  it('ignores small stick movements', () => {
    const p = pad();
    p.axes[0] = 0.1;
    p.axes[1] = -0.3;
    const reading = readGamepad(p, new PadTraits());
    expect(reading.dirs).toBe(0);
    expect(reading.analogX).toBe(0);
  });
});

describe('generic USB joysticks', () => {
  it('reads a hat switch reported as one axis', () => {
    expect(hatDirections(-1)).toBe(Dir.Up);
    expect(hatDirections(-1 + 2 / 7)).toBe(Dir.Up | Dir.Right);
    expect(hatDirections(-1 + 4 / 7)).toBe(Dir.Right);
    expect(hatDirections(1 / 7)).toBe(Dir.Down);
    expect(hatDirections(5 / 7)).toBe(Dir.Left);
    expect(hatDirections(1)).toBe(Dir.Up | Dir.Left);
    expect(hatDirections(HAT_CENTRED)).toBe(0);
  });

  it('learns which axis is a hat from its centred value, then follows it', () => {
    const p = pad({ mapping: '', axes: 10, buttons: 12 });
    p.axes[9] = HAT_CENTRED;
    const traits = new PadTraits();
    expect(readGamepad(p, traits).dirs).toBe(0);
    p.axes[9] = 1 / 7; // down
    expect(readGamepad(p, traits).dirs).toBe(Dir.Down);
  });

  it('reads the main axes and any face button of a simple joystick', () => {
    const p = pad({ id: 'Retro joystick', mapping: '', axes: 2, buttons: 4 });
    p.axes[0] = -1;
    press(p, 3);
    const reading = readGamepad(p, new PadTraits());
    expect(reading.dirs).toBe(Dir.Left);
    expect(reading.fire).toBe(true);
  });

  it('uses axes 6 and 7 as a D-pad only once they have rested at zero', () => {
    const p = pad({ mapping: '', axes: 8, buttons: 12 });
    const traits = new PadTraits();
    p.axes[6] = -1;
    p.axes[7] = -1;
    expect(readGamepad(p, traits).dirs).toBe(0);
    p.axes[6] = 0;
    p.axes[7] = 0;
    readGamepad(p, traits);
    p.axes[7] = 1;
    expect(readGamepad(p, traits).dirs).toBe(Dir.Down);
  });

  it('reads both paddles of a Stelladaptor', () => {
    const p = pad({ id: 'Stelladaptor 2600-to-USB Interface', mapping: '', axes: 2, buttons: 2 });
    p.axes[0] = -1;
    p.axes[1] = 1;
    press(p, 1);
    const reading = readGamepad(p, new PadTraits());
    expect(reading.paddles).toEqual([0, 1]);
    expect(reading.paddleFire).toEqual([false, true]);
  });
});

describe('custom bindings', () => {
  it('replaces the usual controls for bound actions only', () => {
    const p = pad({ mapping: '', axes: 4, buttons: 12 });
    press(p, 5);
    p.axes[1] = -1;
    const bindings = { fire: { kind: 'button', index: 7 }, up: { kind: 'axis', index: 3, direction: 1 } } as const;
    let reading = readGamepad(p, new PadTraits(), bindings);
    expect(reading.fire).toBe(false);
    expect(reading.dirs).toBe(0);
    press(p, 7);
    p.axes[3] = 1;
    reading = readGamepad(p, new PadTraits(), bindings);
    expect(reading.fire).toBe(true);
    expect(reading.dirs).toBe(Dir.Up);
  });

  it('detects the first control pressed, for each action in turn', () => {
    const p = pad({ mapping: '', axes: 10, buttons: 12 });
    p.axes[9] = HAT_CENTRED;
    const prompts: (string | null)[] = [];
    const capture = new BindingCapture(() => p, p, (action) => prompts.push(action));
    capture.poll(); // pad at rest
    p.axes[9] = -1; // hat up
    capture.poll();
    expect(capture.bindings.up).toEqual({ kind: 'hat', index: 9, direction: 'up' });
    capture.poll(); // still held: waits for release
    p.axes[9] = HAT_CENTRED;
    capture.poll();
    p.axes[1] = 0.9;
    capture.poll();
    expect(capture.bindings.down).toEqual({ kind: 'axis', index: 1, direction: 1 });
    p.axes[1] = 0;
    capture.poll();
    capture.skip(); // left
    capture.skip(); // right
    capture.poll();
    press(p, 2);
    capture.poll();
    expect(capture.bindings.fire).toEqual({ kind: 'button', index: 2 });
    expect(prompts.slice(0, 5)).toEqual(['up', 'down', 'left', 'right', 'fire']);
  });

  it('prefers the asked-for direction when a diagonal is pressed', () => {
    const p = pad({ mapping: '', axes: 10 });
    p.axes[9] = HAT_CENTRED;
    const baseline = { buttons: p.buttons.map((b) => b.pressed), axes: [...p.axes] };
    p.axes[9] = -1 + 2 / 7; // up-right
    expect(detectBinding(p, baseline, 'right')).toEqual({ kind: 'hat', index: 9, direction: 'right' });
  });
});

describe('GamepadManager', () => {
  it('gives pads to auto players in the order they were connected', () => {
    const first = pad({ index: 1, id: 'Pad A' });
    const second = pad({ index: 0, id: 'Pad B' });
    let pads: (GamepadLike | null)[] = [null, first];
    const manager = new GamepadManager(() => pads);
    expect(manager.padFor(0)).toBe(first);
    pads = [second, first];
    expect(manager.padFor(0)).toBe(first);
    expect(manager.padFor(1)).toBe(second);
  });

  it('keeps a pad chosen by name with its player, and skips it for auto players', () => {
    const a = pad({ index: 0, id: 'Pad A' });
    const b = pad({ index: 1, id: 'Pad B' });
    let pads: (GamepadLike | null)[] = [a, b];
    const manager = new GamepadManager(() => pads);
    manager.choices[1] = 'id:Pad A';
    expect(manager.padFor(1)).toBe(a);
    expect(manager.padFor(0)).toBe(b);
    // Unplugged: player 2 waits for it rather than taking another pad.
    pads = [null, b];
    expect(manager.padFor(1)).toBe(null);
    expect(manager.padFor(0)).toBe(b);
  });

  it('turns a player off', () => {
    const a = pad({ index: 0 });
    const manager = new GamepadManager(() => [a]);
    manager.choices[0] = 'off';
    expect(manager.padFor(0)).toBe(null);
    expect(manager.padFor(1)).toBe(a);
  });
});
