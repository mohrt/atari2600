import type { PadBindings } from '../io/gamepad-input';
import { JsonRecord } from '../ui/settings';

/** Custom gamepad bindings, remembered per kind of pad (its id string). */
export class GamepadBindings {
  private readonly record: JsonRecord<Record<string, PadBindings>>;
  private cache: Partial<Record<string, PadBindings>>;

  constructor(storage?: Storage | null) {
    this.record = new JsonRecord('atari2600-gamepad-bindings', storage);
    this.cache = this.record.read();
  }

  readonly get = (id: string): PadBindings => this.cache[id] ?? {};

  has(id: string): boolean {
    return Object.keys(this.get(id)).length > 0;
  }

  set(id: string, bindings: PadBindings): void {
    this.cache = { ...this.cache, [id]: bindings };
    if (Object.keys(bindings).length === 0) delete this.cache[id];
    this.record.write(this.cache);
  }
}
