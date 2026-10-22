import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackGameLoaded } from '../src/analytics';

describe('trackGameLoaded', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('names bundled games', () => {
    const gtag = vi.fn();
    vi.stubGlobal('gtag', gtag);
    trackGameLoaded('atari2600', 'Some Game');
    expect(gtag).toHaveBeenCalledWith('event', 'game_loaded', { system: 'atari2600', game: 'Some Game' });
  });

  it("doesn't name the player's own files", () => {
    const gtag = vi.fn();
    vi.stubGlobal('gtag', gtag);
    trackGameLoaded('atari2600');
    expect(gtag).toHaveBeenCalledWith('event', 'game_loaded', { system: 'atari2600', game: 'own file' });
  });

  it('does nothing when the Google tag is missing', () => {
    expect(() => trackGameLoaded('atari2600', 'Some Game')).not.toThrow();
  });
});
