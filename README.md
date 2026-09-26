# Slots Royale

Slots Royale is a 3D five-reel slot machine that runs in the browser: a black lacquered cabinet with a gold bezel and glass reel window, a backlit `SLOTS ROYALE` marquee topper with chasing bulbs, and a chrome pull lever, on a casino floor among other slot machines. A floor attendant and casino guests watch every spin, cheer your wins under a shower of confetti, and groan at your losses. Play the [live demo](https://ronpicard.github.io/slots-royale/) — it works on both phones and desktops.

It plays for credits only. There is no real money, no purchases, and nothing to win.

## How to play

- Pick a coin value (1, 2, 5, 10 or 25 credits per line) with the bet stepper or the number keys. The total bet is the coin value times the twenty paylines, so 20 to 500 credits.
- Press `SPIN`, or pull the lever, to spin the five reels. Winning lines pay left to right from reel 0, every winning line pays, and only the highest matching count on a line counts.
- The wild substitutes for every symbol but scatter; a line of five wilds pays as five sevens.
- Three or more scatters anywhere on the reels award free spins at the triggering bet, with every win doubled, and can retrigger for more.
- Five sevens on a line is the jackpot: 1000 times the coin value.
- `MAX BET` jumps straight to the top coin value. `AUTO` spins a set number of times by itself and stops if you can no longer afford the next one.
- You start with 1,000 credits, and your credits and history are kept in your browser. If you run out, the machine offers a refill.
- The camera follows the game by default: the whole cabinet between spins, close on the reel window while they spin, and a pull-back to see the topper and confetti on a big win. The camera button or `C` cycles it through three fixed views: the reel window, the whole cabinet, and along the row of machines on the casino floor.
- Quick spin runs the reels at double speed. The outcome of a spin does not change.
- While the menu is up, the machine plays itself.

### Keyboard

| Key | Action |
| --- | --- |
| `Space` or `Enter` | Spin |
| `ArrowUp`, `+` or `=` | Bet up |
| `ArrowDown` or `-` | Bet down |
| `X` | Max bet |
| `1` to `5` | Set coin value 1, 2, 5, 10 or 25 |
| `A` | Toggle autoplay (25 spins, or off) |
| `C` | Change camera |
| `Q` | Quick spin |
| `M` | Mute |
| `Escape` | Menu |

## The pays

Pays are in coins per line; multiply by the coin value (and by 2 during free spins) for the credits won.

| Symbol | 3 | 4 | 5 |
| --- | --- | --- | --- |
| Seven | 20 | 100 | 1000 |
| Bar | 15 | 60 | 300 |
| Bell | 10 | 40 | 150 |
| Diamond | 10 | 30 | 120 |
| Cherry | 5 | 20 | 80 |
| Lemon | 4 | 15 | 50 |
| Orange | 4 | 15 | 50 |
| Plum | 3 | 10 | 40 |

Scatter pays anywhere on the reels, regardless of position, on top of the total bet:

| Scatters | Pays | Free spins |
| --- | --- | --- |
| 3 | 2× total bet | 10 |
| 4 | 10× total bet | 15 |
| 5 | 50× total bet | 20 |

Free spins play at the bet that triggered them, with every win doubled, and can retrigger for more.

A spin's win falls into one of five tiers: `jackpot` (five sevens on a line), `mega` (total win 25× the total bet or more), `big` (10× or more), `small` (any other win), or `none`.

## The reels

Each of the five reels is its own strip of 30 to 34 symbols, no two reels alike: low-paying symbols are common, sevens are rare, wilds sit only on the three middle reels, and every strip carries a single scatter.

Each spin draws a random 32-bit seed and turns it into a stop on every reel; nothing else in the game logic calls `Math.random` or the clock, so the same seed always plays out the same spin.

The strips are tuned so the return to player lands at about 96%, as measured over hundreds of thousands of simulated spins. To see the figures yourself:

```bash
npm run simulate -- 200000
```

This runs spins headlessly at coin value 1 with an unlimited bankroll, and prints the overall return split into base-game and free-spin contribution, the hit frequency, the free-spin trigger rate, the jackpot count, the win-tier counts, and the biggest win.

## Settings

The menu offers mute, quick spin (double-speed reels), the camera view, and a reset that clears your credits back to 1,000 after confirming.

## Development

Requires Node >= 22.12.

Everything under `src/game/` is framework-free — no DOM, no three.js, and no non-deterministic calls like `Math.random` or `Date` — so `npm test` runs directly in Node without spinning up a browser.

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server |
| `npm test` | Run the reels, paylines, paytable, session, crowd and autoplay tests |
| `npm run simulate` | Simulate spins headlessly and report the return to player |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build locally |

Add `?quality=high` or `?quality=low` to the address to pin the rendering cost; otherwise the engine steps it down by itself when frames stay slow.

## Deployment

Pushes to `main` run a GitHub Actions workflow that installs dependencies, runs the test suite, builds the production bundle, and publishes the `dist` output to GitHub Pages.

Vite is configured with a relative `base` in `vite.config.ts`, so the built asset paths resolve correctly whether the site is served from the domain root or from a repository subpath like `/slots-royale/`.

## License

[MIT](LICENSE)
