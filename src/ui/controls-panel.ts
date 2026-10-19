import { CONTROLLER_LABELS, CONTROLLER_TYPES, isControllerType, type ControllerType } from '../io/controllers/types';
import type { PadChoice } from '../io/gamepad-input';
import { isKeySetName, type KeySetName } from '../io/keyboard-input';

export type PlayerNumber = 1 | 2;
const PLAYERS: PlayerNumber[] = [1, 2];
export type TouchMode = 'auto' | 'on' | 'off';
export type ControllerChoice = 'auto' | ControllerType;

export interface ControlsPanelCallbacks {
  onPlayerKeys(player: PlayerNumber, keys: KeySetName | null): void;
  onPlayerPad(player: PlayerNumber, choice: PadChoice): void;
  onRemap(player: PlayerNumber): void;
  onRemapSkip(): void;
  onRemapDefaults(): void;
  onRemapCancel(): void;
  onController(port: 0 | 1, choice: ControllerChoice): void;
  onPhosphor(enabled: boolean): void;
  onTouchMode(mode: TouchMode): void;
  onShowGamepadInput(show: boolean): void;
  onSound(enabled: boolean): void;
  /** Volume from 0 to 1. */
  onVolume(volume: number): void;
  focusScreen(): void;
}

function requireField<T extends HTMLElement>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Controls panel is missing ${selector}`);
  return element;
}

function toPadChoice(value: string): PadChoice {
  if (value === 'off' || value.startsWith('id:')) return value as PadChoice;
  return 'auto';
}

function option(value: string, label: string): HTMLOptionElement {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}

/** Fills the gamepad menus. Call before the remembered settings are restored, and when pads come and go. */
export function fillPadMenus(root: Element, pads: { id: string; name: string }[], keep: string[]): void {
  for (const player of PLAYERS) {
    const select = requireField<HTMLSelectElement>(root, `[name="player${player}-pad"]`);
    const current = select.value || keep[player - 1] || 'auto';
    const ids = new Set(pads.map((pad) => `id:${pad.id}`));
    const options = [option('auto', player === 1 ? 'First gamepad' : 'Next gamepad'), option('off', 'No gamepad')];
    for (const pad of pads) options.push(option(`id:${pad.id}`, pad.name));
    // A pad chosen earlier keeps its place while unplugged.
    for (const wanted of [current, keep[player - 1]]) {
      if (wanted?.startsWith('id:') && !ids.has(wanted)) {
        ids.add(wanted);
        options.push(option(wanted, `${wanted.slice(3).replace(/\s*\(.*$/, '')} (not connected)`));
      }
    }
    select.replaceChildren(...options);
    select.value = current;
    if (!select.value) select.value = 'auto';
  }
}

export interface ControlsPanel {
  /** Shows the controller in each port: Auto (with the detected one) or the player's choice. */
  setControllers(detected: [ControllerType, ControllerType], chosen: [ControllerChoice, ControllerChoice]): void;
  showRemap(prompt: string | null, capturing?: boolean): void;
  setGamepadStatus(lines: string[]): void;
  showSoundHint(visible: boolean): void;
  disableSound(reason: string): void;
}

/** Settings for the players' keys and gamepads, the controllers in each port, and sound. */
export function attachControlsPanel(root: HTMLElement, callbacks: ControlsPanelCallbacks): ControlsPanel {
  const keysFor = (player: PlayerNumber) => requireField<HTMLSelectElement>(root, `[name="player${player}-keys"]`);
  const padFor = (player: PlayerNumber) => requireField<HTMLSelectElement>(root, `[name="player${player}-pad"]`);
  const controllers = [
    requireField<HTMLSelectElement>(root, '[name="left-controller"]'),
    requireField<HTMLSelectElement>(root, '[name="right-controller"]'),
  ];
  const phosphor = requireField<HTMLInputElement>(root, '[name="phosphor"]');
  const touch = requireField<HTMLSelectElement>(root, '[name="touch-controls"]');
  const showInput = requireField<HTMLInputElement>(root, '[name="show-gamepad-input"]');
  const sound = requireField<HTMLInputElement>(root, '[name="sound"]');
  const volume = requireField<HTMLInputElement>(root, '[name="volume"]');
  const soundHint = requireField<HTMLElement>(root, '.sound-hint');
  const remap = requireField<HTMLElement>(root, '.remap');
  const remapPrompt = requireField<HTMLElement>(root, '.remap-prompt');
  const gamepadStatus = requireField<HTMLElement>(root, '.gamepad-status');

  const change = (field: HTMLSelectElement, value: string) => {
    if (field.value === value) return;
    field.value = value;
    field.dispatchEvent(new Event('change'));
  };
  const thenRefocus = (handler: () => void) => () => {
    handler();
    callbacks.focusScreen();
  };

  for (const player of PLAYERS) {
    const other: PlayerNumber = player === 1 ? 2 : 1;
    const keys = keysFor(player);
    const pad = padFor(player);
    // The same keys can only work one player, so taking them moves them.
    keys.addEventListener(
      'change',
      thenRefocus(() => {
        if (keys.value !== 'off' && keysFor(other).value === keys.value) change(keysFor(other), 'off');
        callbacks.onPlayerKeys(player, isKeySetName(keys.value) ? keys.value : null);
      }),
    );
    pad.addEventListener(
      'change',
      thenRefocus(() => {
        if (pad.value.startsWith('id:') && padFor(other).value === pad.value) change(padFor(other), 'auto');
        callbacks.onPlayerPad(player, toPadChoice(pad.value));
      }),
    );
    requireField<HTMLButtonElement>(root, `[data-action="remap"][data-player="${player}"]`).addEventListener('click', () =>
      callbacks.onRemap(player),
    );
  }
  requireField<HTMLButtonElement>(root, '[data-action="swap-players"]').addEventListener(
    'click',
    thenRefocus(() => {
      const [keys1, pad1] = [keysFor(1).value, padFor(1).value];
      const [keys2, pad2] = [keysFor(2).value, padFor(2).value];
      change(keysFor(1), 'off');
      change(padFor(1), 'off');
      change(keysFor(2), keys1);
      change(padFor(2), pad1);
      change(keysFor(1), keys2);
      change(padFor(1), pad2);
    }),
  );
  requireField<HTMLButtonElement>(root, '[data-action="remap-skip"]').addEventListener('click', () => callbacks.onRemapSkip());
  requireField<HTMLButtonElement>(root, '[data-action="remap-defaults"]').addEventListener(
    'click',
    thenRefocus(() => callbacks.onRemapDefaults()),
  );
  requireField<HTMLButtonElement>(root, '[data-action="remap-cancel"]').addEventListener(
    'click',
    thenRefocus(() => callbacks.onRemapCancel()),
  );

  controllers.forEach((select, port) => {
    select.addEventListener(
      'change',
      thenRefocus(() => callbacks.onController(port as 0 | 1, isControllerType(select.value) ? select.value : 'auto')),
    );
  });
  phosphor.addEventListener('change', thenRefocus(() => callbacks.onPhosphor(phosphor.checked)));
  touch.addEventListener('change', thenRefocus(() => callbacks.onTouchMode(touch.value as TouchMode)));
  showInput.addEventListener(
    'change',
    thenRefocus(() => {
      if (!showInput.checked) gamepadStatus.hidden = true;
      callbacks.onShowGamepadInput(showInput.checked);
    }),
  );
  sound.addEventListener('change', thenRefocus(() => callbacks.onSound(sound.checked)));
  // The slider keeps focus while dragged and hands it back when released.
  volume.addEventListener('input', () => callbacks.onVolume(Number(volume.value)));
  volume.addEventListener('change', () => callbacks.focusScreen());

  // Apply the initial selections (which may have been restored from an earlier visit).
  for (const player of PLAYERS) {
    const keys = keysFor(player).value;
    callbacks.onPlayerKeys(player, isKeySetName(keys) ? keys : null);
    callbacks.onPlayerPad(player, toPadChoice(padFor(player).value));
  }
  callbacks.onPhosphor(phosphor.checked);
  callbacks.onTouchMode(touch.value as TouchMode);
  callbacks.onShowGamepadInput(showInput.checked);
  callbacks.onSound(sound.checked);
  callbacks.onVolume(Number(volume.value));

  return {
    setControllers: (detected, chosen) => {
      controllers.forEach((select, port) => {
        select.replaceChildren(
          option('auto', `Auto (${CONTROLLER_LABELS[detected[port]]})`),
          ...CONTROLLER_TYPES.map((type) => option(type, CONTROLLER_LABELS[type])),
        );
        select.value = chosen[port];
      });
    },
    showRemap: (prompt, capturing = true) => {
      remap.hidden = prompt === null;
      remapPrompt.textContent = prompt ?? '';
      requireField<HTMLButtonElement>(root, '[data-action="remap-skip"]').hidden = !capturing;
      requireField<HTMLButtonElement>(root, '[data-action="remap-defaults"]').hidden = !capturing;
    },
    setGamepadStatus: (lines) => {
      const paragraphs = lines.map((line) => {
        const p = document.createElement('p');
        p.textContent = line;
        return p;
      });
      const same =
        paragraphs.length === gamepadStatus.children.length &&
        paragraphs.every((p, i) => p.textContent === gamepadStatus.children[i].textContent);
      if (!same) gamepadStatus.replaceChildren(...paragraphs);
      gamepadStatus.hidden = lines.length === 0;
    },
    showSoundHint: (visible) => (soundHint.hidden = !visible),
    disableSound: (reason) => {
      sound.disabled = volume.disabled = true;
      sound.checked = false;
      soundHint.hidden = false;
      soundHint.textContent = reason;
    },
  };
}
