/**
 * Lookup tables for the movable objects. Each object has a position counter
 * (0-159) that advances on every visible colour clock; its pixels are drawn
 * where the counter falls inside one of its copies. The tables are indexed by
 * the object's settings * 160 + counter, so the per-pixel work is one lookup.
 */

export const COUNTER_RANGE = 160;

/** Copy start offsets for each NUSIZ number-and-size setting (bits 0-2). */
const COPIES: number[][] = [[0], [0, 16], [0, 32], [0, 16, 32], [0, 64], [0], [0, 32, 64], [0]];
/** Player width scale per NUSIZ setting (5 is double, 7 is quad). */
const PLAYER_SCALE = [1, 1, 1, 1, 1, 2, 1, 4];

/** Marks a pixel of the main (first) copy, which isn't drawn on the line its RESPx was hit. */
export const MAIN_COPY = 0x10;

/**
 * Player pixel table: the graphics bit (0 = leftmost) shown at each counter
 * value, ORed with MAIN_COPY for the first copy; -1 where nothing is drawn.
 * Stretched players start one clock later than single-width ones.
 */
export const PLAYER_PIXELS = buildPlayerPixels();

function buildPlayerPixels(): Int8Array {
  const table = new Int8Array(8 * COUNTER_RANGE).fill(-1);
  for (let mode = 0; mode < 8; mode++) {
    const scale = PLAYER_SCALE[mode];
    const delay = scale > 1 ? 1 : 0;
    COPIES[mode].forEach((offset, copy) => {
      for (let pixel = 0; pixel < 8 * scale; pixel++) {
        const counter = (offset + delay + pixel) % COUNTER_RANGE;
        table[mode * COUNTER_RANGE + counter] = Math.floor(pixel / scale) | (copy === 0 ? MAIN_COPY : 0);
      }
    });
  }
  return table;
}

/**
 * Missile table, indexed by ((NUSIZ & 7) * 4 + size) * 160 + counter:
 * 0 = off, 1 = a pixel of a later copy, 1 | MAIN_COPY = a pixel of the first.
 * Missiles follow the player's copies, but are single in the double/quad modes.
 */
export const MISSILE_PIXELS = buildMissilePixels();

function buildMissilePixels(): Uint8Array {
  const table = new Uint8Array(8 * 4 * COUNTER_RANGE);
  for (let mode = 0; mode < 8; mode++) {
    for (let size = 0; size < 4; size++) {
      const base = (mode * 4 + size) * COUNTER_RANGE;
      COPIES[mode].forEach((offset, copy) => {
        for (let pixel = 0; pixel < 1 << size; pixel++) {
          table[base + ((offset + pixel) % COUNTER_RANGE)] = 1 | (copy === 0 ? MAIN_COPY : 0);
        }
      });
    }
  }
  return table;
}

/** Ball table, indexed by size * 160 + counter (one copy, 1/2/4/8 pixels wide). */
export const BALL_PIXELS = buildBallPixels();

function buildBallPixels(): Uint8Array {
  const table = new Uint8Array(4 * COUNTER_RANGE);
  for (let size = 0; size < 4; size++) {
    for (let pixel = 0; pixel < 1 << size; pixel++) table[size * COUNTER_RANGE + pixel] = 1 | MAIN_COPY;
  }
  return table;
}

/** Each byte with its bits in the opposite order (for REFPx). */
export const REVERSED = buildReversed();

function buildReversed(): Uint8Array {
  const table = new Uint8Array(256);
  for (let value = 0; value < 256; value++) {
    let reversed = 0;
    for (let bit = 0; bit < 8; bit++) if (value & (1 << bit)) reversed |= 0x80 >> bit;
    table[value] = reversed;
  }
  return table;
}

/** Missile offset from its player's left edge while RESMPx locks it to the player's centre. */
export const RESMP_OFFSET = [3, 3, 3, 3, 3, 6, 3, 10];

// Object bits used for collisions and priority.
export const P0 = 0x01;
export const P1 = 0x02;
export const M0 = 0x04;
export const M1 = 0x08;
export const BL = 0x10;
export const PF = 0x20;

/**
 * The 15 collision latches for each combination of objects, in register order:
 * bit 2r is bit 7 and bit 2r+1 is bit 6 of collision register r (CXM0P..CXPPMM).
 */
export const COLLISIONS = buildCollisions();

function buildCollisions(): Uint16Array {
  const pairs: [number, number][] = [
    [M0, P1], [M0, P0],
    [M1, P0], [M1, P1],
    [P0, PF], [P0, BL],
    [P1, PF], [P1, BL],
    [M0, PF], [M0, BL],
    [M1, PF], [M1, BL],
    [BL, PF], [0, 0],
    [P0, P1], [M0, M1],
  ];
  const table = new Uint16Array(64);
  for (let mask = 0; mask < 64; mask++) {
    pairs.forEach(([a, b], bit) => {
      if (a && (mask & a) && (mask & b)) table[mask] |= 1 << bit;
    });
  }
  return table;
}
