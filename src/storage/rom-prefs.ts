import type { SchemeName } from '../cart/cartridge';
import type { ControllerType } from '../io/controllers/types';
import { JsonRecord } from '../ui/settings';

/** Choices remembered for one game. */
export interface RomPref {
  scheme?: SchemeName;
  left?: ControllerType;
  right?: ControllerType;
}

const MAX_ROMS = 200;

/** Per-game settings (bank-switching override, controllers), kept in localStorage by ROM hash. */
export class RomPrefs {
  private readonly record: JsonRecord<Record<string, RomPref & { used: number }>>;

  constructor(storage?: Storage | null) {
    this.record = new JsonRecord('atari2600-rom-prefs', storage);
  }

  get(id: string): RomPref {
    return this.record.read()[id] ?? {};
  }

  update(id: string, changes: Partial<RomPref>): void {
    const all = this.record.read();
    const next = { ...all[id], ...changes, used: Date.now() };
    for (const key of Object.keys(changes) as (keyof RomPref)[]) {
      if (changes[key] === undefined) delete next[key];
    }
    all[id] = next;
    // Forget the least recently used games beyond the limit.
    const ids = Object.keys(all).sort((a, b) => (all[b]?.used ?? 0) - (all[a]?.used ?? 0));
    for (const old of ids.slice(MAX_ROMS)) delete all[old];
    this.record.write(all);
  }
}
