/**
 * Shared types for Slots Royale's game logic (`src/game/`). Everything here is plain data: no
 * classes, no three.js, no DOM, so the maths can run under `node --test` and in the browser alike,
 * and a session can be serialised as JSON.
 *
 * The machine: five reels, three rows, twenty fixed paylines. Wins pay left to right on a line
 * for three or more matching symbols, the wild stands in for any paying symbol, and three or more
 * scatters anywhere award free spins with every win doubled.
 */

export type SymbolId =
  | 'seven'
  | 'bar'
  | 'bell'
  | 'diamond'
  | 'cherry'
  | 'lemon'
  | 'orange'
  | 'plum'
  | 'wild'
  | 'scatter'

export const REEL_COUNT = 5
export const ROW_COUNT = 3
export const LINE_COUNT = 20

/** Credits bet per line. The total bet is the coin value times `LINE_COUNT`. */
export type CoinValue = 1 | 2 | 5 | 10 | 25

/** A cell of the reel window: reel 0 is leftmost, row 0 is the top. */
export interface Cell {
  reel: number
  row: number
}

export interface LineWin {
  /** Payline index, 0 to `LINE_COUNT - 1`. */
  line: number
  /** The paying symbol (never 'wild' unless the line is all wilds). */
  symbol: SymbolId
  /** Matching symbols from the left, 3 to 5. */
  count: number
  /** Credits won on this line, already multiplied by the coin value and any free-spin multiplier. */
  payout: number
  cells: Cell[]
}

export interface ScatterWin {
  count: number
  /** Credits won for the scatters themselves (paid on the total bet). */
  payout: number
  freeSpins: number
  cells: Cell[]
}

/** 'big' is 10x the total bet or more, 'mega' 25x or more, 'jackpot' five sevens on a line. */
export type WinTier = 'none' | 'small' | 'big' | 'mega' | 'jackpot'

export interface SpinOutcome {
  /** Stop index of each reel on its strip. */
  stops: number[]
  /** `window[reel][row]`: the symbols showing. */
  window: SymbolId[][]
  lineWins: LineWin[]
  scatter: ScatterWin | null
  /** Sum of the line and scatter payouts. */
  totalWin: number
  tier: WinTier
  /** This spin was a free spin (no bet was taken). */
  free: boolean
  /** Total bet this spin was evaluated against (the bet that started the free spins for a free spin). */
  bet: number
}

export interface FreeSpins {
  remaining: number
  /** Awarded in total this bonus, including retriggers. */
  total: number
  /** Credits won so far in this bonus. */
  won: number
  /** Multiplier applied to every win during the bonus. */
  multiplier: number
  /** The bet the bonus was triggered at; free spins play at this bet. */
  bet: number
}

/** 'idle' takes a bet. 'spinning' waits for the reels to stop. 'result' shows the outcome until the next spin. */
export type SessionPhase = 'idle' | 'spinning' | 'result'

export interface SessionStats {
  spins: number
  totalBet: number
  totalWon: number
  biggestWin: number
  freeSpinsPlayed: number
  jackpots: number
  peakBankroll: number
}

export interface Session {
  phase: SessionPhase
  /** Credits in the machine. */
  bankroll: number
  coinValue: CoinValue
  freeSpins: FreeSpins | null
  /** Spins still to run by themselves; 0 when autoplay is off. */
  autoplayRemaining: number
  /** The spin in progress or just finished. */
  lastOutcome: SpinOutcome | null
  /** Credits won on past spins, newest first, at most `HISTORY_LENGTH` (in `session.ts`). Zero for a losing spin. */
  history: number[]
  stats: SessionStats
}

/** What persists between visits. */
export interface SessionSave {
  version: 1
  bankroll: number
  coinValue: CoinValue
  history: number[]
  stats: SessionStats
}

export type SoundName =
  | 'coinIn'
  | 'betChange'
  | 'lever'
  | 'spinStart'
  | 'reelStop'
  | 'anticipation'
  | 'winSmall'
  | 'winBig'
  | 'winMega'
  | 'jackpot'
  | 'freeSpins'
  | 'freeSpinStart'
  | 'coinPayout'
  | 'cheer'
  | 'groan'
  | 'refill'

/** What the engine must do after a rules function runs. */
export type Command =
  | { type: 'spin'; outcome: SpinOutcome }
  | { type: 'freeSpinsAwarded'; count: number; total: number }
  | { type: 'freeSpinsOver'; won: number }
  | { type: 'sound'; name: SoundName }
  | { type: 'message'; text: string; seconds: number }
  /** Save the session to storage now. */
  | { type: 'save' }

export interface Transition {
  session: Session
  commands: Command[]
}
