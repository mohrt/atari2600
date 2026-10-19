import { describe, expect, it } from 'vitest';
import { Cpu6507 } from '../src/cpu/cpu6507';
import { FlatBus } from './helpers/flat-bus';

// Documented cycle counts without page-cross or branch penalties (0 = JAM).
const CYCLES = [
  7,6,0,8,3,3,5,5,3,2,2,2,4,4,6,6,
  2,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7,
  6,6,0,8,3,3,5,5,4,2,2,2,4,4,6,6,
  2,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7,
  6,6,0,8,3,3,5,5,3,2,2,2,3,4,6,6,
  2,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7,
  6,6,0,8,3,3,5,5,4,2,2,2,5,4,6,6,
  2,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7,
  2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,
  2,6,0,6,4,4,4,4,2,5,2,5,5,5,5,5,
  2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,
  2,5,0,5,4,4,4,4,2,4,2,4,4,4,4,4,
  2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6,
  2,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7,
  2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6,
  2,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7,
];

const BRANCHES = new Set([0x10, 0x30, 0x50, 0x70, 0x90, 0xb0, 0xd0, 0xf0]);

function machine(program: number[], at = 0x0200): { cpu: Cpu6507; bus: FlatBus } {
  const bus = new FlatBus();
  bus.load(at, program);
  const cpu = new Cpu6507(bus);
  cpu.pc = at;
  return { cpu, bus };
}

function cyclesOf(cpu: Cpu6507, bus: FlatBus): number {
  const before = bus.cycles;
  cpu.step();
  return bus.cycles - before;
}

describe('Cpu6507 timing', () => {
  it('uses the documented cycle count for every opcode', () => {
    for (let opcode = 0; opcode < 256; opcode++) {
      if (CYCLES[opcode] === 0 || BRANCHES.has(opcode)) continue;
      // Operands point at $0310 / zero page $10 (holding pointer $0000): no page crossings.
      const { cpu, bus } = machine([opcode, 0x10, 0x03]);
      cpu.sp = 0xff;
      expect(cyclesOf(cpu, bus), `opcode $${opcode.toString(16)}`).toBe(CYCLES[opcode]);
    }
  });

  it('adds a cycle when an indexed read crosses a page', () => {
    const { cpu, bus } = machine([0xbd, 0xff, 0x03]); // LDA $03FF,X
    cpu.x = 1;
    expect(cyclesOf(cpu, bus)).toBe(5);
  });

  it('always takes the extra cycle for indexed stores', () => {
    const { cpu, bus } = machine([0x9d, 0x00, 0x03]); // STA $0300,X
    cpu.x = 1;
    expect(cyclesOf(cpu, bus)).toBe(5);
  });

  it('adds one cycle for a taken branch and two across a page', () => {
    let { cpu, bus } = machine([0xd0, 0x02]); // BNE +2
    cpu.flagZ = true;
    expect(cyclesOf(cpu, bus)).toBe(2);
    ({ cpu, bus } = machine([0xd0, 0x02]));
    expect(cyclesOf(cpu, bus)).toBe(3);
    expect(cpu.pc).toBe(0x0204);
    ({ cpu, bus } = machine([0xd0, 0x10], 0x02f0));
    expect(cyclesOf(cpu, bus)).toBe(4);
    expect(cpu.pc).toBe(0x0302);
  });

  it('performs the dummy accesses of read-modify-write instructions', () => {
    const { cpu, bus } = machine([0xee, 0x10, 0x03]); // INC $0310
    bus.memory[0x0310] = 5;
    bus.logging = true;
    cpu.step();
    expect(bus.log).toEqual(['R 200', 'R 201', 'R 202', 'R 310', 'W 310', 'W 310']);
    expect(bus.memory[0x0310]).toBe(6);
  });

  it('reads the reset vector after seven cycles', () => {
    const bus = new FlatBus();
    bus.memory[0xfffc] = 0x00;
    bus.memory[0xfffd] = 0xf0;
    const cpu = new Cpu6507(bus);
    cpu.reset();
    expect(bus.cycles).toBe(7);
    expect(cpu.pc).toBe(0xf000);
    expect(cpu.sp).toBe(0xfd);
  });
});

describe('Cpu6507 operations', () => {
  it('adds in decimal mode', () => {
    const { cpu } = machine([0xf8, 0x18, 0xa9, 0x19, 0x69, 0x28]); // SED CLC LDA #$19 ADC #$28
    for (let i = 0; i < 4; i++) cpu.step();
    expect(cpu.a).toBe(0x47);
    expect(cpu.flagC).toBe(false);
  });

  it('subtracts in decimal mode with borrow', () => {
    const { cpu } = machine([0xf8, 0x38, 0xa9, 0x10, 0xe9, 0x01]); // SED SEC LDA #$10 SBC #$01
    for (let i = 0; i < 4; i++) cpu.step();
    expect(cpu.a).toBe(0x09);
    expect(cpu.flagC).toBe(true);
  });

  it('runs JSR and RTS', () => {
    const { cpu, bus } = machine([0x20, 0x00, 0x03, 0xea]);
    bus.memory[0x0300] = 0x60;
    cpu.sp = 0xff;
    expect(cyclesOf(cpu, bus)).toBe(6);
    expect(cpu.pc).toBe(0x0300);
    expect(cyclesOf(cpu, bus)).toBe(6);
    expect(cpu.pc).toBe(0x0203);
  });

  it('executes LAX and SAX', () => {
    const { cpu, bus } = machine([0xa7, 0x10, 0x87, 0x11]);
    bus.memory[0x10] = 0x3c;
    cpu.step();
    expect(cpu.a).toBe(0x3c);
    expect(cpu.x).toBe(0x3c);
    cpu.x = 0x0f;
    cpu.step();
    expect(bus.memory[0x11]).toBe(0x0c);
  });

  it('halts on JAM and keeps the bus busy', () => {
    const { cpu, bus } = machine([0x02]);
    cpu.step();
    expect(cpu.jammedAt).toBe(0x0200);
    expect(cyclesOf(cpu, bus)).toBe(1);
  });
});
