import type { Cell, CoinValue, LineWin, ScatterWin, SymbolId, WinTier } from './types.ts'
import { LINE_COUNT, REEL_COUNT, ROW_COUNT } from './types.ts'
import { PAYLINES } from './paylines.ts'

/**
 * Coins-per-line paytable and the scatter/free-spin rules. `evaluate` reads a settled window
 * against the twenty paylines: a line pays for its longest run of matches from reel 0 (the wild
 * substitutes for any paying symbol, but never for the scatter, and a run of five wilds pays as
 * five sevens); only the highest run per line counts, and every winning line pays. The scatter
 * pays anywhere on the window and awards free spins on top of its own payout.
 */

export const PAYTABLE: Record<Exclude<SymbolId, 'wild' | 'scatter'>, readonly [three: number, four: number, five: number]> = {
  seven: [20, 100, 1000],
  bar: [15, 60, 300],
  bell: [10, 40, 150],
  diamond: [10, 30, 120],
  cherry: [5, 20, 80],
  lemon: [4, 15, 50],
  orange: [4, 15, 50],
  plum: [3, 10, 40],
}

/** Scatter payout, in multiples of the total bet, for 3, 4 or 5 scatters anywhere on the window. */
export const SCATTER_PAYS: readonly [three: number, four: number, five: number] = [2, 10, 50]
/** Free spins awarded alongside the scatter payout. */
export const SCATTER_FREE_SPINS: readonly [three: number, four: number, five: number] = [10, 15, 20]
/** Every win during a free-spin bonus is multiplied by this. */
export const FREE_SPIN_MULTIPLIER = 2

type PayingSymbol = Exclude<SymbolId, 'wild' | 'scatter'>

/** The line's paying symbol and its run length from reel 0, or `null` when the run is under 3. */
function evaluateLine(symbols: readonly SymbolId[]): { symbol: PayingSymbol; count: number } | null {
  let symbol: PayingSymbol | null = null
  for (const s of symbols) {
    if (s === 'wild' || s === 'scatter') continue
    symbol = s
    break
  }
  // Every symbol read so far was wild (or there were none): an all-wild run pays as sevens.
  const paying = symbol ?? 'seven'

  let count = 0
  for (const s of symbols) {
    if (s === 'wild' || s === paying) count++
    else break
  }
  return count >= 3 ? { symbol: paying, count } : null
}

function evaluateScatter(window: SymbolId[][], bet: number, multiplier: number): ScatterWin | null {
  const cells: Cell[] = []
  for (let reel = 0; reel < REEL_COUNT; reel++) {
    for (let row = 0; row < ROW_COUNT; row++) {
      if (window[reel]![row] === 'scatter') cells.push({ reel, row })
    }
  }
  if (cells.length < 3) return null
  const index = Math.min(cells.length, 5) - 3
  return {
    count: cells.length,
    payout: SCATTER_PAYS[index]! * bet * multiplier,
    freeSpins: SCATTER_FREE_SPINS[index]!,
    cells,
  }
}

/** Evaluates a settled window against the paylines and the scatter, at `coinValue` and any free-spin `multiplier`. */
export function evaluate(
  window: SymbolId[][],
  coinValue: CoinValue,
  multiplier: number,
): { lineWins: LineWin[]; scatter: ScatterWin | null; totalWin: number; tier: WinTier } {
  const bet = coinValue * LINE_COUNT
  const lineWins: LineWin[] = []

  for (let line = 0; line < PAYLINES.length; line++) {
    const rows = PAYLINES[line]!
    const symbols = rows.map((row, reel) => window[reel]![row]!)
    const hit = evaluateLine(symbols)
    if (hit === null) continue
    const payout = PAYTABLE[hit.symbol][hit.count - 3]! * coinValue * multiplier
    const cells: Cell[] = rows.slice(0, hit.count).map((row, reel) => ({ reel, row }))
    lineWins.push({ line, symbol: hit.symbol, count: hit.count, payout, cells })
  }

  const scatter = evaluateScatter(window, bet, multiplier)
  const totalWin = lineWins.reduce((sum, win) => sum + win.payout, 0) + (scatter?.payout ?? 0)
  const jackpot = lineWins.some((win) => win.symbol === 'seven' && win.count === 5)

  let tier: WinTier
  if (jackpot) tier = 'jackpot'
  else if (totalWin >= bet * 25) tier = 'mega'
  else if (totalWin >= bet * 10) tier = 'big'
  else if (totalWin > 0) tier = 'small'
  else tier = 'none'

  return { lineWins, scatter, totalWin, tier }
}
