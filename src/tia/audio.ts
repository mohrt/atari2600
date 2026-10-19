/** Output sequence of a maximal-length shift register (right shift, feedback from two taps). */
function polynomial(bits: number, tapA: number, tapB: number): Uint8Array {
  const length = (1 << bits) - 1;
  const out = new Uint8Array(length);
  let register = length;
  for (let i = 0; i < length; i++) {
    out[i] = register & 1;
    const feedback = ((register >> tapA) ^ (register >> tapB)) & 1;
    register = (register >> 1) | (feedback << (bits - 1));
  }
  return out;
}

export const POLY4 = polynomial(4, 0, 1);
export const POLY5 = polynomial(5, 0, 2);
export const POLY9 = polynomial(9, 0, 4);
/** The "divide by 31" clock is high for 13 of every 31 steps. */
export const DIV31 = Uint8Array.from({ length: 31 }, (_, i) => (i === 0 || i === 13 ? 1 : 0));

/** Low-pass coefficient at the TIA's ~31 kHz rate (about 10 kHz cut-off). */
const LOWPASS = 0.86;
/** DC blocker pole at the output rate. */
const DC_POLE = 0.995;
/** Peak-to-peak output with both channels at full volume (centred on zero by the DC blocker). */
const AMPLITUDE = 1.2;

/**
 * The TIA's two sound channels, clocked twice per scanline. Each has a 5-bit
 * frequency divider (AUDF), a waveform selector (AUDC: pure tones, 4/5/9-bit
 * polynomial noise and combinations) and a 4-bit volume (AUDV). The output is
 * resampled to the browser's audio rate.
 */
export class TiaAudio {
  readonly audc = new Uint8Array(2);
  readonly audf = new Uint8Array(2);
  readonly audv = new Uint8Array(2);
  readonly divCount = new Int32Array(2);
  readonly divMax = new Int32Array(2);
  readonly p4 = new Int32Array(2);
  readonly p5 = new Int32Array(2);
  readonly p9 = new Int32Array(2);
  /** Current waveform level (0 or 1) of each channel; the volume scales it. */
  readonly level = new Uint8Array(2);

  inputRate = 31400;
  outputRate = 48000;
  phase = 0;
  lowpassed = 0;
  dcIn = 0;
  dcOut = 0;
  private buffer = new Float32Array(4096);
  private length = 0;

  reset(): void {
    for (const array of [this.audc, this.audf, this.audv, this.level]) array.fill(0);
    for (const array of [this.divCount, this.divMax, this.p4, this.p5, this.p9]) array.fill(0);
    this.updateDivider(0);
    this.updateDivider(1);
  }

  setRates(inputRate: number, outputRate: number): void {
    this.inputRate = inputRate;
    this.outputRate = outputRate;
  }

  /** Writes AUDC0/1 (reg 0/1), AUDF0/1 (2/3) or AUDV0/1 (4/5). */
  write(reg: number, value: number): void {
    const channel = reg & 1;
    if (reg < 2) this.audc[channel] = value & 0x0f;
    else if (reg < 4) this.audf[channel] = value & 0x1f;
    else this.audv[channel] = value & 0x0f;
    if (reg < 4) this.updateDivider(channel);
  }

  private updateDivider(channel: number): void {
    const audc = this.audc[channel];
    let max = 0;
    if (audc === 0x00 || audc === 0x0b) {
      // "Set to 1": the output is the volume itself (used to play samples through AUDV).
      this.level[channel] = 1;
    } else {
      max = this.audf[channel] + 1;
      if ((audc & 0x0c) === 0x0c) max *= 3;
    }
    if (max !== this.divMax[channel]) {
      this.divMax[channel] = max;
      if (this.divCount[channel] === 0 || max === 0) this.divCount[channel] = max;
    }
  }

  /** One audio clock: steps both channels and feeds the resampler. */
  clock(): void {
    this.step(0);
    this.step(1);
    const mix = (this.level[0] * this.audv[0] + this.level[1] * this.audv[1]) / 30;
    this.lowpassed += (mix - this.lowpassed) * LOWPASS;
    this.phase += this.outputRate;
    while (this.phase >= this.inputRate) {
      this.phase -= this.inputRate;
      this.emit(this.lowpassed * AMPLITUDE);
    }
  }

  private step(ch: number): void {
    const count = this.divCount[ch];
    if (count > 1) {
      this.divCount[ch] = count - 1;
      return;
    }
    if (count !== 1) return;
    this.divCount[ch] = this.divMax[ch];
    const p5 = (this.p5[ch] + 1) % POLY5.length;
    this.p5[ch] = p5;
    const audc = this.audc[ch];
    // Bits 0-1 choose what clocks the waveform: every step, the div-31 pattern or the 5-bit poly.
    const clocked = (audc & 0x02) === 0 || ((audc & 0x01) === 0 ? DIV31[p5] : POLY5[p5]);
    if (!clocked) return;
    if (audc & 0x04) {
      this.level[ch] ^= 1; // pure tone (divide by 2)
    } else if (audc & 0x08) {
      if (audc === 0x08) {
        const p9 = (this.p9[ch] + 1) % POLY9.length;
        this.p9[ch] = p9;
        this.level[ch] = POLY9[p9];
      } else {
        this.level[ch] = POLY5[p5];
      }
    } else {
      const p4 = (this.p4[ch] + 1) % POLY4.length;
      this.p4[ch] = p4;
      this.level[ch] = POLY4[p4];
    }
  }

  private emit(sample: number): void {
    // Remove the TIA's DC offset so silence sits at zero.
    this.dcOut = sample - this.dcIn + DC_POLE * this.dcOut;
    this.dcIn = sample;
    if (this.length === this.buffer.length) {
      const bigger = new Float32Array(this.buffer.length * 2);
      bigger.set(this.buffer);
      this.buffer = bigger;
    }
    this.buffer[this.length++] = this.dcOut;
  }

  /** The samples produced since the last call. */
  takeSamples(): Float32Array {
    const samples = this.buffer.slice(0, this.length);
    this.length = 0;
    return samples;
  }
}
