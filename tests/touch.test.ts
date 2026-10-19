import { describe, expect, it } from 'vitest';
import { Dir } from '../src/io/controllers/types';
import { stickDirections } from '../src/io/touch-controls';

describe('touch stick', () => {
  it('gives eight directions and nothing near the centre', () => {
    expect(stickDirections(0.1, 0.1)).toBe(0);
    expect(stickDirections(1, 0)).toBe(Dir.Right);
    expect(stickDirections(0, -1)).toBe(Dir.Up);
    expect(stickDirections(-1, 0.05)).toBe(Dir.Left);
    expect(stickDirections(0.7, 0.7)).toBe(Dir.Down | Dir.Right);
    expect(stickDirections(-0.7, -0.7)).toBe(Dir.Up | Dir.Left);
    expect(stickDirections(0.2, 0.9)).toBe(Dir.Down);
  });
});
