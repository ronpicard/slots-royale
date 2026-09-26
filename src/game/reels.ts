import type { SymbolId } from './types.ts'

/**
 * The five reel strips and the window they show through the cabinet's glass. Reel order runs
 * left to right (0 to 4); each strip is read top to bottom for rows 0, 1, 2, wrapping at the end.
 * The seven is rare (one per strip) and the wild appears only on reels 1 to 3, one per strip, so
 * the outer reels never show one; the scatter appears once per strip on every reel. With only
 * twenty lines, the paytable needs the middle tier (bar, bell, diamond) weighted as heavily as the
 * low symbols to land in range; `scripts/simulate.ts` is how that weighting was tuned so the Monte
 * Carlo return to player lands between 94% and 97%.
 */

/** Display order for the paytable and the pay-line pop-ups: the seven first, then high to low. */
export const SYMBOL_ORDER: readonly SymbolId[] = [
  'seven',
  'bar',
  'bell',
  'diamond',
  'cherry',
  'lemon',
  'orange',
  'plum',
  'wild',
  'scatter',
]

/** Builds a strip from symbol counts, round-robining through `SYMBOL_ORDER` so no run repeats. */
function buildStrip(counts: Partial<Record<SymbolId, number>>): SymbolId[] {
  const remaining = new Map<SymbolId, number>()
  for (const symbol of SYMBOL_ORDER) {
    const count = counts[symbol]
    if (count) remaining.set(symbol, count)
  }
  const strip: SymbolId[] = []
  while (remaining.size > 0) {
    for (const symbol of SYMBOL_ORDER) {
      const left = remaining.get(symbol)
      if (left === undefined) continue
      strip.push(symbol)
      if (left <= 1) remaining.delete(symbol)
      else remaining.set(symbol, left - 1)
    }
  }
  return strip
}

export const REEL_STRIPS: readonly (readonly SymbolId[])[] = [
  // length 30, no wild
  buildStrip({ seven: 1, bar: 6, bell: 6, diamond: 5, cherry: 5, lemon: 2, orange: 2, plum: 2, scatter: 1 }),
  // length 32, one wild
  buildStrip({ seven: 1, bar: 7, bell: 6, diamond: 5, cherry: 5, lemon: 2, orange: 2, plum: 2, wild: 1, scatter: 1 }),
  // length 34, one wild
  buildStrip({ seven: 1, bar: 7, bell: 6, diamond: 5, cherry: 5, lemon: 3, orange: 3, plum: 2, wild: 1, scatter: 1 }),
  // length 31, one wild
  buildStrip({ seven: 1, bar: 7, bell: 6, diamond: 5, cherry: 4, lemon: 2, orange: 2, plum: 2, wild: 1, scatter: 1 }),
  // length 33, no wild
  buildStrip({ seven: 1, bar: 7, bell: 6, diamond: 5, cherry: 5, lemon: 3, orange: 3, plum: 2, scatter: 1 }),
]

/** Window shown through the glass: `window[reel][row]`, rows 0 (top) to 2 (bottom) from `stops[reel]`. */
export function windowFor(stops: readonly number[]): SymbolId[][] {
  return REEL_STRIPS.map((strip, reel) => {
    const stop = stops[reel]!
    return [0, 1, 2].map((offset) => strip[(stop + offset) % strip.length]!)
  })
}

/** Deterministic stops from `rng`, one draw per reel in reel order. */
export function stopsFor(rng: () => number): number[] {
  return REEL_STRIPS.map((strip) => Math.floor(rng() * strip.length))
}
