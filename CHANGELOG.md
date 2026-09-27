# Changelog

All notable changes to Slots Royale are documented in this file, following the [Keep a Changelog](https://keepachangelog.com/) format.

## [1.3.1] - 2026-09-27

### Fixed

- The reel whirr no longer keeps pulsing quietly in the background after the reels have stopped: its tremolo now scales with the reels' level instead of sitting on top of it.

### Changed

- The spinning sound is softer: a low-passed rush with a gentle motor purr underneath and mellower ticks, in place of the band-passed hiss.

## [1.3.0] - 2026-09-27

### Added

- Two named camera views in place of the old auto/reels/cabinet trio: `Close` (the default) frames the reel window a little further back than before, so the gold bezel, the payline plaques and the top of the button deck are in shot, and `Wide` stands back to show the whole cabinet and its marquee. `Floor` is unchanged, and a saved camera choice from an earlier version maps onto its nearest new view.

### Changed

- The reels are classic backlit cream strips with a gold border on every tile and richer symbol colours, the glare on the glass is toned down so the symbols read clearly, and the cabinet carries gold pinstripes, a chrome hairline inside the bezel and a burgundy lacquer panel under the window.
- The HUD and menu are dressed as a lounge: warm burgundy-tinted glass with gold hairlines top and bottom, serif numerals for credits and bets, a bevelled gold `SPIN` button and a gradient-gold title.
- Every sound plays through a shared room reverb. Coins are metallic clinks instead of filtered noise, reel stops land with a mechanical tock, the reel whirr flutters as it turns, wins ring a bell tree in the music's key, the jackpot hammers a mechanical bell over its siren and coin cascade, and the lever twangs its return spring.
- The lounge band gained a drummer (kick, brushed snare and a fill into every eighth bar) and a string pad, the vibraphone now plays phrases that answer each other and hands the lead to the keys every sixteen bars, and the set runs a 32-bar form with a bridge and a four-bar intro.

## [1.2.0] - 2026-09-26

### Changed

- The background is now live lounge music, synthesised in code like every other sound: a walking bass, brushed ride and hi-hat, Rhodes chord stabs and a wandering vibraphone over two alternating eight-bar progressions, in place of the crowd-murmur noise bed. It still ducks while the reels spin.

## [1.1.0] - 2026-09-25

### Changed

- The default camera now stays parked close on the reel window from spin to spin, instead of pulling back to the whole cabinet between spins and on big wins.
- The reel window reads as real glass: a clearcoated pane that reflects the room, a glare streak from the ceiling lights, a shadowed recess around the reels, and a highlight that sweeps across the pane when a win pays.
- The reels blur into a streak while they are at speed and each one flashes its backlight as it stops.

## [1.0.0] - 2026-09-25

### Added

- A 3D five-reel, three-row slot machine in a casino: a black lacquered cabinet with a gold bezel and glass reel window, a backlit `SLOTS ROYALE` marquee topper with chasing bulbs, a chrome pull lever, a sloped button deck and coin tray, and a casino floor of other slot machines, a floor attendant and guests.
- Twenty fixed paylines and coin values of 1, 2, 5, 10 or 25 credits per line, for a total bet of 20 to 500.
- Ten symbols — seven, bar, bell, diamond, cherry, lemon, orange, plum, wild and scatter — with the wild substituting for every symbol but scatter, and matching lines of 3, 4 or 5 paying left to right from reel 0; every winning line pays.
- Scatter wins anywhere on the reels: 3, 4 or 5 scatters pay 2×, 10× or 50× the total bet and award 10, 15 or 20 free spins, played at the triggering bet with every win doubled, and can retrigger.
- A jackpot for five sevens on a line, paying 1000 times the coin value, plus mega, big and small win tiers with their own sounds and topper effects.
- Reels tuned to a return to player of about 96%, and a headless `npm run simulate` script that reports it over hundreds of thousands of simulated spins.
- A bet stepper, `MAX BET` and `AUTO` (10, 25 or 50 spins) controls, a history strip of the last 20 spins, and a paytable modal with the full pays, the scatter and free-spin rules, and a grid of the twenty paylines.
- Spectators around the machine who cheer your wins, louder the bigger the win, and groan at your losses, plus confetti and a flashing win lamp on a big win.
- A camera that follows the game by default — the whole cabinet between spins, the reel window while they spin, and a pull-back on a big win — plus reels, cabinet and floor fixed views.
- Quick spin, which runs the reels at double speed without changing the outcome.
- Credits, history and settings saved in your browser, with a refill when you run out. Play credits only: no real money and no purchases.
- Keyboard controls, and touch controls sized for phones in both orientations.
- An attract mode that plays the machine by itself behind the menu.
- Synthesised casino sound effects, including the reels, the lever and coin payouts, with a mute toggle.
- Deployed to GitHub Pages on every push to `main`.
