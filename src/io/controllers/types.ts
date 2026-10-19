/** The controllers that plug into the 2600's two ports. */
export const CONTROLLER_TYPES = ['joystick', 'paddles', 'driving', 'keypad'] as const;
export type ControllerType = (typeof CONTROLLER_TYPES)[number];

export const CONTROLLER_LABELS: Record<ControllerType, string> = {
  joystick: 'Joystick',
  paddles: 'Paddles',
  driving: 'Driving controller',
  keypad: 'Keypad',
};

/** Direction bits, in the order of a joystick port's pins (up, down, left, right). */
export const Dir = {
  Up: 0x01,
  Down: 0x02,
  Left: 0x04,
  Right: 0x08,
} as const;

/** Keypad keys in order: 1 2 3 / 4 5 6 / 7 8 9 / * 0 #. Bit n of a keypad mask is key n. */
export const KEYPAD_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

export function isControllerType(value: unknown): value is ControllerType {
  return typeof value === 'string' && (CONTROLLER_TYPES as readonly string[]).includes(value);
}
