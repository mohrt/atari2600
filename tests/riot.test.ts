import { describe, expect, it } from 'vitest';
import { Riot6532 } from '../src/riot/riot6532';

const INTIM = 0x284;
const TIMINT = 0x285;
const TIM1T = 0x294;
const TIM64T = 0x296;
const T1024T = 0x297;

function ticks(riot: Riot6532, count: number): void {
  for (let i = 0; i < count; i++) riot.tick();
}

describe('Riot6532 timer', () => {
  it('counts down once per interval after the first cycle', () => {
    const riot = new Riot6532();
    riot.writeIo(TIM64T, 3);
    expect(riot.readIo(INTIM)).toBe(3);
    riot.tick();
    expect(riot.readIo(INTIM)).toBe(2);
    ticks(riot, 63);
    expect(riot.readIo(INTIM)).toBe(2);
    riot.tick();
    expect(riot.readIo(INTIM)).toBe(1);
  });

  it('underflows after value * interval + 1 cycles, then counts every cycle', () => {
    const riot = new Riot6532();
    riot.writeIo(TIM64T, 2);
    ticks(riot, 2 * 64);
    expect(riot.readIo(INTIM)).toBe(0);
    expect(riot.readIo(TIMINT) & 0x80).toBe(0);
    riot.tick();
    expect(riot.readIo(TIMINT) & 0x80).toBe(0x80);
    expect(riot.readIo(INTIM)).toBe(0xff);
    riot.tick();
    expect(riot.readIo(INTIM)).toBe(0xfe);
  });

  it('clears the timer flag when INTIM is read or the timer is written', () => {
    const riot = new Riot6532();
    riot.writeIo(TIM1T, 0);
    riot.tick();
    expect(riot.readIo(TIMINT) & 0x80).toBe(0x80);
    riot.readIo(INTIM);
    expect(riot.readIo(TIMINT) & 0x80).toBe(0);
    riot.writeIo(T1024T, 0);
    riot.tick();
    expect(riot.timerFlag).toBe(true);
    riot.writeIo(T1024T, 10);
    expect(riot.timerFlag).toBe(false);
    expect(riot.interval).toBe(1024);
  });
});

describe('Riot6532 ports', () => {
  it('mixes output latches and input pins by direction', () => {
    const riot = new Riot6532();
    riot.portAPins = () => 0b1010_1111;
    expect(riot.readIo(0x280)).toBe(0b1010_1111);
    riot.writeIo(0x281, 0xf0); // upper nibble output
    riot.writeIo(0x280, 0x50);
    expect(riot.readIo(0x280)).toBe(0x5f);
    expect(riot.readIo(0x281)).toBe(0xf0);
  });

  it('lets the pins see what is driven (keypad rows)', () => {
    const riot = new Riot6532();
    let seen = -1;
    riot.portAPins = (outputs, directions) => {
      seen = outputs & directions;
      return 0xff;
    };
    riot.writeIo(0x281, 0xf0);
    riot.writeIo(0x280, 0xe0);
    riot.readIo(0x280);
    expect(seen).toBe(0xe0);
  });

  it('reads the console switches on port B', () => {
    const riot = new Riot6532();
    riot.portBPins = () => 0x0b;
    expect(riot.readIo(0x282)).toBe(0x0b);
  });

  it('flags a falling edge on PA7', () => {
    const riot = new Riot6532();
    let pins = 0xff;
    riot.portAPins = () => pins;
    riot.checkPa7();
    pins = 0x7f;
    riot.checkPa7();
    expect(riot.readIo(TIMINT) & 0x40).toBe(0x40);
    expect(riot.readIo(TIMINT) & 0x40).toBe(0);
  });
});
