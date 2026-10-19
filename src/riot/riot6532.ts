/** TIM1T, TIM8T, TIM64T and T1024T divide the CPU clock by these powers of two. */
const TIMER_SHIFTS = [0, 3, 6, 10];

/** Reads the pins of an I/O port, given the bits the RIOT drives as outputs. */
export type PortPins = (outputs: number, directions: number) => number;

const allHigh: PortPins = () => 0xff;

/**
 * The 6532 RIOT: 128 bytes of RAM, an interval timer and two 8-bit I/O ports.
 * Port A carries the joysticks (and keypad rows); port B the console switches.
 * Stepped once per CPU cycle.
 */
export class Riot6532 {
  readonly ram = new Uint8Array(128);

  /** Output latches and data direction registers (1 = output). */
  outA = 0;
  ddrA = 0;
  outB = 0;
  ddrB = 0;

  timer = 0;
  /** CPU cycles between timer decrements (1 after an underflow until the timer is written again). */
  interval = 1024;
  prescale = 1024;
  timerFlag = false;
  pa7Flag = false;
  pa7RisingEdge = false;
  private lastPa7 = 1;

  portAPins: PortPins = allHigh;
  portBPins: PortPins = allHigh;

  reset(): void {
    this.ram.fill(0);
    this.outA = this.ddrA = this.outB = this.ddrB = 0;
    this.timer = 0;
    this.interval = this.prescale = 1024;
    this.timerFlag = this.pa7Flag = this.pa7RisingEdge = false;
    this.lastPa7 = 1;
  }

  tick(): void {
    if (--this.prescale > 0) return;
    this.prescale = this.interval;
    if (this.timer === 0) {
      this.timer = 0xff;
      this.timerFlag = true;
      this.interval = this.prescale = 1;
    } else {
      this.timer--;
    }
  }

  /** Accesses with A7 set and A9 set: I/O ports and timer. */
  readIo(addr: number): number {
    if (addr & 0x04) {
      if (addr & 0x01) {
        const flags = (this.timerFlag ? 0x80 : 0) | (this.pa7Flag ? 0x40 : 0);
        this.pa7Flag = false;
        return flags;
      }
      this.timerFlag = false;
      return this.timer;
    }
    switch (addr & 0x03) {
      case 0:
        return this.readPortA();
      case 1:
        return this.ddrA;
      case 2:
        return (this.outB & this.ddrB) | (this.portBPins(this.outB, this.ddrB) & ~this.ddrB & 0xff);
      default:
        return this.ddrB;
    }
  }

  writeIo(addr: number, value: number): void {
    if (addr & 0x04) {
      if (addr & 0x10) {
        this.timer = value;
        this.interval = 1 << TIMER_SHIFTS[addr & 0x03];
        // The first decrement comes on the next cycle, then one per interval.
        this.prescale = 1;
        this.timerFlag = false;
      } else {
        this.pa7RisingEdge = (addr & 0x01) !== 0;
      }
      return;
    }
    switch (addr & 0x03) {
      case 0:
        this.outA = value;
        break;
      case 1:
        this.ddrA = value;
        break;
      case 2:
        this.outB = value;
        break;
      default:
        this.ddrB = value;
    }
    this.checkPa7();
  }

  /** Call when the controllers change, so a PA7 edge sets its flag. */
  checkPa7(): void {
    this.readPortA();
  }

  private readPortA(): number {
    const value = (this.outA & this.ddrA) | (this.portAPins(this.outA, this.ddrA) & ~this.ddrA & 0xff);
    const pa7 = value >> 7;
    if (pa7 !== this.lastPa7 && pa7 === (this.pa7RisingEdge ? 1 : 0)) this.pa7Flag = true;
    this.lastPa7 = pa7;
    return value;
  }
}
