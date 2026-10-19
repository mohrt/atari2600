# Atari 2600 in the browser

**Play it at [mohrt.github.io/atari2600](https://mohrt.github.io/atari2600/)**

An Atari 2600 emulator written from scratch in TypeScript: a cycle-exact 6507 CPU, the TIA (picture, sound and controller inputs) emulated one colour clock at a time, the 6532 RIOT, and all the common cartridge bank-switching schemes. Drop a `.a26`, `.bin` or `.rom` file (or a `.zip` containing one) onto the page to play it. No BIOS or system ROM is needed.

## Controllers

- **Gamepads and USB joysticks** work as soon as you press one of their buttons: the first is player 1, the second player 2, and pads plugged in while playing are picked up straight away. Standard pads use the D-pad or left stick and any face button; generic USB joysticks and arcade sticks also work through their main axes or a hat switch. If a stick isn't recognised, **Remap** asks you to press each control in turn and remembers the result for that kind of pad. A pad's Start is Game Reset and Back is Game Select. **Show gamepad input** lists what each pad is sending.
- **Keyboard**: player 1 uses the arrow keys and Space by default; W A S D + F and the numpad are also available, for either player.
- **Paddles**: click the screen to turn paddle 1 with the mouse (Esc lets go), or turn with a stick or the arrow keys. A Stelladaptor or 2600-daptor gives you real paddles.
- **Driving controller** (Indy 500) and **keypads** are supported too; keypads use 1 2 3 / Q W E / A S D / Z X C on the left and 8 9 0 / I O P / K L ; / , . / on the right.
- **Touch controls** (a joystick, Fire, Select and Reset, a paddle strip or a keypad) appear on phones and tablets.

Each game's controllers are guessed from its code and shown as "Auto" under the screen; a different choice is remembered for that game.

## Console switches

F1 is Game Select and F2 Game Reset; F3/F4 set the TV type to colour or black and white; F5/F6 set the left difficulty to A or B, and F7/F8 the right. They are also in the toolbar, along with pause, power cycle, full screen and the TV standard (Auto picks NTSC, or PAL from the game's frame rate). Save states keep the whole console, cartridge included, in the browser; they can be exported and imported as `.a26state` files. **Phosphor** blends each frame with the last so flickering sprites look solid.

## Cartridges

Supported bank-switching schemes: 2K, 4K, CV, F8, F6, F4 and EF (each with or without the Superchip RAM), FE (Activision), E0 (Parker Bros), E7 (M-Network), 3F (Tigervision), 3E, FA (CBS RAM Plus), UA and 0840. The scheme is detected from the image; the cartridge panel can override it, and the choice is remembered for that game.

No game files are included in this repository. Commercial 2600 games are still under copyright, so use images of games you own. `npm run fetch:games` downloads the freely licensed homebrews listed in `scripts/games-catalog.json` (each with its credit, licence and checksum) into `public/games/`, where they appear in a "Free games" picker. To offer other games, list them in `public/games/index.json` the same way: `{ "games": [{ "title": "Some Game", "file": "some-game.bin", "controller": "paddles" }] }`.

## Development

```sh
npm install
npm run fetch:games     # optional: free games into public/games/
npm run dev             # http://localhost:5173
npm test                # tests needing the free games or the CPU test binary skip when they're missing
npm run fetch:dormann   # optional: 6502 functional test binary for the CPU test
```

`SHOTS=/tmp/shots npm test` also saves a screenshot of each free game.

## Deploying

`.github/workflows/pages.yml` tests and builds the site and deploys it to GitHub Pages on every push to `main` (Pages source: "GitHub Actions").
