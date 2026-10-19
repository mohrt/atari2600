import type { TvStandard } from './atari2600';
import { AudioOutput } from './audio/audio-output';
import type { SchemeName } from './cart/cartridge';
import { createCartridge, detectScheme } from './cart/detect';
import { filesFrom, readMedia, romId, titleFromFileName } from './cart/load';
import { Emulator } from './emulator';
import { fetchGame, loadGameManifest, type BundledGame } from './games';
import { guessControllers } from './io/controllers/detect';
import { ControllerPorts } from './io/controllers/ports';
import type { ControllerType } from './io/controllers/types';
import {
  ACTION_LABELS,
  BindingCapture,
  GamepadManager,
  MAX_PLAYERS,
  describeGamepads,
  padName,
} from './io/gamepad-input';
import { KeyboardInput } from './io/keyboard-input';
import { MousePaddle } from './io/mouse-paddle';
import { TouchControls } from './io/touch-controls';
import { PIXEL_ASPECT, WINDOW_LINES } from './render/frame-window';
import { Screen } from './render/screen';
import { GamepadBindings } from './storage/gamepad-bindings';
import { RomPrefs } from './storage/rom-prefs';
import { SaveStates, decodeSession, encodeSession, type SaveStateRecord, type Session } from './storage/save-states';
import { memoryStores, openBrowserStores, type KeyValueStore } from './storage/store';
import { VISIBLE_WIDTH } from './tia/tia';
import { CartPanel } from './ui/cart-panel';
import { attachControlsPanel, fillPadMenus, type ControllerChoice, type TouchMode } from './ui/controls-panel';
import { downloadFile } from './ui/download';
import { Settings } from './ui/settings';
import { attachToolbar } from './ui/toolbar';

/** Form fields whose values are remembered between visits. */
const REMEMBERED_SETTINGS = [
  'tv',
  'tv-type',
  'left-difficulty',
  'right-difficulty',
  'player1-keys',
  'player1-pad',
  'player2-keys',
  'player2-pad',
  'phosphor',
  'touch-controls',
  'show-gamepad-input',
  'sound',
  'volume',
];

/** Longest gap the loop catches up on, so a backgrounded tab doesn't run a burst of frames. */
const MAX_FRAME_MS = 100;
const GAMEPAD_STATUS_INTERVAL_MS = 100;

interface CurrentCartridge {
  image: Uint8Array;
  fileName: string;
  title: string;
  id: string;
  detectedScheme: SchemeName;
  scheme: SchemeName;
  detectedControllers: [ControllerType, ControllerType];
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Page is missing ${selector}`);
  return element;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'atari2600';
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Sizes the screen for the picture of an NTSC or PAL TV. */
function showScreenAspect(tv: TvStandard): void {
  const aspect = (VISIBLE_WIDTH * PIXEL_ASPECT[tv]) / WINDOW_LINES[tv];
  document.documentElement.style.setProperty('--screen-aspect', aspect.toFixed(4));
}

async function main(): Promise<void> {
  const canvas = requireElement<HTMLCanvasElement>('#screen');
  const status = requireElement<HTMLParagraphElement>('#status');
  const screenFrame = requireElement<HTMLElement>('.screen-frame');
  const controlsRoot = requireElement<HTMLElement>('#controls');

  try {
    const settings = new Settings();
    const romPrefs = new RomPrefs();
    const bindings = new GamepadBindings();
    const gamepads = new GamepadManager();
    // The gamepad menus must offer remembered pads before the settings are restored into them.
    const rememberedPads = [String(settings.get('player1-pad') ?? ''), String(settings.get('player2-pad') ?? '')];
    fillPadMenus(controlsRoot, [], rememberedPads);
    settings.bind(document, REMEMBERED_SETTINGS);

    const screen = new Screen(canvas, WINDOW_LINES.ntsc);
    const emulator = new Emulator(screen);
    const machine = emulator.machine;
    const ports = new ControllerPorts(machine);
    const audio = await AudioOutput.create().catch((error: unknown) => {
      console.warn('Audio is unavailable:', error);
      return null;
    });
    if (audio) emulator.setAudioRate(audio.sampleRate);

    let current: CurrentCartridge | null = null;
    let paused = false;
    let bundledGames: BundledGame[] = [];
    const focusScreen = () => canvas.focus();

    const updateStatus = () => {
      const parts = [current ? `${current.title} (${current.scheme})` : 'No cartridge', machine.tv.toUpperCase()];
      status.textContent = `${parts.join(' · ')} · Arrows + Space = joystick · F1 Select · F2 Reset`;
    };
    emulator.onTvChange = (tv) => {
      showScreenAspect(tv);
      updateStatus();
    };
    showScreenAspect('ntsc');

    // --- Inputs ------------------------------------------------------------------
    const keyboard = new KeyboardInput(ports, {
      onSwitchesChanged: () => toolbar.showSwitches(ports.switches),
      onPause: () => toolbar.setPaused(!toolbar.paused),
    });
    keyboard.attach(window);
    let showGamepadInput = false;
    const mouse = new MousePaddle(canvas, ports.players[0]);
    const touchRoot = requireElement<HTMLElement>('#touch-controls');
    const touch = new TouchControls(touchRoot, ports.players[0], ports.switches.buttons);
    const coarsePointer = matchMedia('(pointer: coarse)');
    let touchMode: TouchMode = 'auto';
    const applyTouchMode = () => touch.setVisible(touchMode === 'on' || (touchMode === 'auto' && coarsePointer.matches));
    coarsePointer.addEventListener('change', applyTouchMode);

    const refreshPadMenus = () => {
      const seen = new Set<string>();
      const pads = gamepads
        .connected()
        .filter((pad) => !seen.has(pad.id) && seen.add(pad.id))
        .map((pad) => ({ id: pad.id, name: padName(pad) }));
      fillPadMenus(controlsRoot, pads, rememberedPads);
    };
    gamepads.attach(window);
    gamepads.onChange = refreshPadMenus;

    /** Applies the controller types for the cartridge: the player's choice, else the detected ones. */
    const applyControllers = (chosen?: [ControllerChoice, ControllerChoice]) => {
      const pref = current ? romPrefs.get(current.id) : {};
      const detected = current?.detectedControllers ?? ['joystick', 'joystick'];
      const choice: [ControllerChoice, ControllerChoice] = chosen ?? [pref.left ?? 'auto', pref.right ?? 'auto'];
      const types = choice.map((c, port) => (c === 'auto' ? detected[port] : c)) as [ControllerType, ControllerType];
      ports.setType(0, types[0]);
      ports.setType(1, types[1]);
      controls.setControllers(detected, choice);
      mouse.setEnabled(types[0] === 'paddles');
      touch.setController(types[0]);
    };

    // --- Remapping gamepads ------------------------------------------------------------
    let remap: { padId: string; capture: BindingCapture } | null = null;
    const endRemap = () => {
      remap = null;
      controls.showRemap(null);
    };

    // --- Cartridges ------------------------------------------------------------------
    const insertImage = async (image: Uint8Array, fileName: string, game?: BundledGame) => {
      const id = await romId(image);
      const pref = romPrefs.get(id);
      const detectedScheme = detectScheme(image);
      const scheme = pref.scheme ?? detectedScheme;
      emulator.insertCartridge(createCartridge(image, scheme));
      const guessed = guessControllers(image);
      current = {
        image,
        fileName,
        title: game?.title ?? titleFromFileName(baseName(fileName.split(' from ')[0])),
        id,
        detectedScheme,
        scheme,
        detectedControllers: game?.controller ? [game.controller, guessed[1]] : guessed,
      };
      applyControllers();
      cartPanel.showCartridge(current.title, fileName);
      cartPanel.setScheme(detectedScheme, pref.scheme ?? 'auto');
      screenFrame.classList.remove('no-cartridge');
      toolbar.setCanSave(true);
      audio?.flush();
      updateStatus();
    };

    const eject = () => {
      emulator.insertCartridge(null);
      current = null;
      cartPanel.showEmpty();
      screenFrame.classList.add('no-cartridge');
      toolbar.setCanSave(false);
      applyControllers();
      updateStatus();
    };

    // --- Save states -----------------------------------------------------------------
    const stores = await openBrowserStores().catch((error: unknown) => {
      console.warn('Browser storage is unavailable; save states will last until the page is closed.', error);
      return memoryStores();
    });
    const saveStates = new SaveStates(stores.saveStates as KeyValueStore<SaveStateRecord>);
    const currentSession = (): Session => {
      if (!current) throw new Error('Insert a cartridge first.');
      return {
        machine: machine.saveState(),
        rom: current.image,
        romName: current.fileName,
        title: current.title,
        scheme: current.scheme,
        controllers: [ports.types[0], ports.types[1]],
        switches: {
          color: ports.switches.color,
          leftDifficultyA: ports.switches.leftDifficultyA,
          rightDifficultyA: ports.switches.rightDifficultyA,
        },
      };
    };
    const restoreSession = async (session: Session) => {
      const id = await romId(session.rom);
      emulator.insertCartridge(createCartridge(session.rom, session.scheme));
      machine.loadState(session.machine);
      emulator.restoredTv(session.machine.tv);
      const detectedControllers = guessControllers(session.rom);
      current = {
        image: session.rom,
        fileName: session.romName,
        title: session.title,
        id,
        detectedScheme: detectScheme(session.rom),
        scheme: session.scheme,
        detectedControllers,
      };
      applyControllers(
        session.controllers.map((type, port) => (type === detectedControllers[port] ? 'auto' : type)) as [
          ControllerChoice,
          ControllerChoice,
        ],
      );
      toolbar.showSwitches(session.switches);
      cartPanel.showCartridge(session.title, session.romName);
      cartPanel.setScheme(current.detectedScheme, session.scheme === current.detectedScheme ? 'auto' : session.scheme);
      screenFrame.classList.remove('no-cartridge');
      toolbar.setCanSave(true);
      audio?.flush();
      updateStatus();
    };

    // --- Panels ----------------------------------------------------------------------
    const cartPanel = new CartPanel(requireElement('#cart-panel'), {
      onFile: async (file) => {
        const files = await filesFrom(file);
        const fromZip = files[0] !== file;
        const chosen = files[0];
        if (fromZip) cartPanel.setZipFiles(files, chosen.name);
        else if (cartPanel.zipContents.includes(file)) cartPanel.setZipFiles(cartPanel.zipContents, file.name);
        else cartPanel.setZipFiles([], null);
        const media = await readMedia(chosen);
        if (media.kind === 'state') {
          await restoreSession(await decodeSession(media.bytes));
          toolbar.showMessage('Save state loaded');
          return;
        }
        const game = bundledGames.find((entry) => baseName(entry.file) === chosen.name);
        await insertImage(media.image, fromZip ? `${chosen.name} from ${file.name}` : chosen.name, game);
      },
      onGame: (index) => fetchGame(import.meta.env.BASE_URL, bundledGames[index]),
      onEject: eject,
      onScheme: (scheme) => {
        if (!current) return;
        romPrefs.update(current.id, { scheme: scheme === 'auto' ? undefined : scheme });
        current.scheme = scheme === 'auto' ? current.detectedScheme : scheme;
        try {
          emulator.insertCartridge(createCartridge(current.image, current.scheme));
          cartPanel.showMessage('');
        } catch (error) {
          cartPanel.showMessage(error instanceof Error ? error.message : String(error));
        }
        updateStatus();
      },
      focusScreen,
    });

    const controls = attachControlsPanel(controlsRoot, {
      onPlayerKeys: (player, keys) => keyboard.setPlayerKeys(player === 1 ? 0 : 1, keys),
      onPlayerPad: (player, choice) => {
        gamepads.choices[player - 1] = choice;
        rememberedPads[player - 1] = choice;
      },
      onRemap: (player) => {
        const pad = gamepads.padFor(player - 1);
        if (!pad) {
          controls.showRemap(`No gamepad for player ${player} yet: plug one in and press one of its buttons.`, false);
          return;
        }
        const name = padName(pad);
        const capture = new BindingCapture(
          () => gamepads.padFor(player - 1),
          pad,
          (action) => {
            if (action) {
              controls.showRemap(`Press ${ACTION_LABELS[action]} on ${name} (or Skip to keep the usual one)`);
              return;
            }
            bindings.set(pad.id, capture.bindings);
            endRemap();
            toolbar.showMessage(`Buttons saved for ${name}`);
          },
        );
        remap = { padId: pad.id, capture };
      },
      onRemapSkip: () => remap?.capture.skip(),
      onRemapDefaults: () => {
        if (remap) bindings.set(remap.padId, {});
        endRemap();
        toolbar.showMessage('Using the usual buttons');
      },
      onRemapCancel: endRemap,
      onController: (port, choice) => {
        const type = choice === 'auto' ? undefined : choice;
        if (current) romPrefs.update(current.id, port === 0 ? { left: type } : { right: type });
        const pref = current ? romPrefs.get(current.id) : {};
        const chosen: [ControllerChoice, ControllerChoice] = [pref.left ?? 'auto', pref.right ?? 'auto'];
        chosen[port] = choice;
        applyControllers(chosen);
      },
      onPhosphor: (enabled) => (screen.phosphor = enabled),
      onTouchMode: (mode) => {
        touchMode = mode;
        applyTouchMode();
      },
      onShowGamepadInput: (show) => (showGamepadInput = show),
      onSound: (enabled) => audio?.setEnabled(enabled),
      onVolume: (volume) => audio?.setVolume(volume),
      focusScreen,
    });
    refreshPadMenus();
    if (!audio) {
      controls.disableSound('Sound is not supported in this browser');
    } else if (!audio.running) {
      controls.showSoundHint(true);
      audio.resumeOnGesture(window, () => controls.showSoundHint(false));
    }

    const refreshStates = async () => toolbar.setStates(await saveStates.list());
    const toolbar = attachToolbar(requireElement('#toolbar'), {
      onPause: (pause) => {
        paused = pause;
        screenFrame.classList.toggle('paused', pause);
        emulator.resetTiming();
        audio?.flush();
      },
      onPowerCycle: () => {
        machine.reset();
        audio?.flush();
      },
      onFullscreen: () => {
        if (document.fullscreenElement) {
          void document.exitFullscreen();
          return;
        }
        void screenFrame.requestFullscreen().then(() => {
          focusScreen();
          // Phones play best sideways; browsers that can't lock just refuse.
          const orientation = window.screen.orientation as ScreenOrientation & { lock?: (to: string) => Promise<void> };
          orientation?.lock?.('landscape').catch(() => {});
        });
      },
      onTv: (setting) => emulator.setTvSetting(setting),
      onConsoleButtons: (reset, select) => ports.switches.buttons.set('toolbar', reset, select),
      onSwitches: (switches) => Object.assign(ports.switches, switches),
      onSaveState: async () => {
        const session = currentSession();
        await saveStates.add(session.title, session);
        await refreshStates();
        toolbar.showMessage('State saved');
      },
      onLoadState: async (id) => {
        const session = await saveStates.load(id);
        if (!session) throw new Error('That save state no longer exists.');
        await restoreSession(session);
        toolbar.showMessage('State loaded');
      },
      onDeleteState: async (id) => {
        await saveStates.delete(id);
        await refreshStates();
      },
      onExportState: async () => {
        const session = currentSession();
        downloadFile(await encodeSession(session), `${slug(session.title)}.a26state`);
      },
      onImportState: async (file) => {
        await restoreSession(await decodeSession(new Uint8Array(await file.arrayBuffer())));
        toolbar.showMessage('Save state loaded');
      },
      focusScreen,
    });
    toolbar.setCanSave(false);
    await refreshStates();

    void loadGameManifest(import.meta.env.BASE_URL).then((games) => {
      bundledGames = games;
      const href = (link?: string) => (link?.startsWith('games/') ? `${import.meta.env.BASE_URL}${link}` : link);
      cartPanel.setGames(games.map((game) => ({ ...game, licenseHref: href(game.licenseUrl), sourceHref: href(game.sourceUrl) })));
    });

    // --- Main loop -----------------------------------------------------------------
    const pollGamepads = () => {
      const pads = gamepads.connected();
      let reset = false;
      let select = false;
      ports.players.forEach((player) => player.clear('paddle-adapter'));
      for (let p = 0; p < MAX_PLAYERS; p++) {
        const reading = gamepads.read(p, bindings.get, pads);
        if (!reading) {
          ports.players[p].clear('gamepad');
          continue;
        }
        reset ||= reading.reset;
        select ||= reading.select;
        // A paddle adapter brings a pair of paddles: players 1 and 2 (left port) or 3 and 4 (right).
        if (reading.paddles && p < 2 && ports.types[p] === 'paddles') {
          ports.players[p * 2].set('gamepad', { paddle: reading.paddles[0], fire: reading.paddleFire[0] });
          ports.players[p * 2 + 1].set('paddle-adapter', { paddle: reading.paddles[1], fire: reading.paddleFire[1] });
          continue;
        }
        ports.players[p].set('gamepad', { dirs: reading.dirs, fire: reading.fire, analogX: reading.analogX });
      }
      ports.switches.buttons.set('gamepad', reset, select);
    };

    let last = performance.now();
    let lastGamepadStatus = 0;
    const frame = (now: number) => {
      const elapsed = Math.min(now - last, MAX_FRAME_MS);
      last = now;
      pollGamepads();
      remap?.capture.poll();
      ports.update(paused ? 0 : elapsed);
      if (!paused) emulator.run(elapsed);
      const samples = emulator.takeAudioSamples();
      if (!paused) audio?.play(samples);
      screen.present();
      if (showGamepadInput && now - lastGamepadStatus > GAMEPAD_STATUS_INTERVAL_MS) {
        lastGamepadStatus = now;
        const lines = describeGamepads(gamepads, bindings.get);
        controls.setGamepadStatus(lines.length ? lines : ['No gamepad found yet: plug one in and press one of its buttons.']);
      }
      requestAnimationFrame(frame);
    };

    screenFrame.classList.add('no-cartridge');
    applyControllers();
    updateStatus();
    focusScreen();
    requestAnimationFrame(frame);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

void main();
