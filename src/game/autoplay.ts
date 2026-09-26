/**
 * Attract-mode demo coin value: a deterministic, pure function of a seed and the bankroll
 * available, so the same seed always draws the same-looking bet size.
 */

import type { CoinValue } from './types.ts'
import { LINE_COUNT } from './types.ts'
import { COIN_VALUES } from './session.ts'

/** Weight per `COIN_VALUES` entry, peaked at the middle denomination. */
const MIDDLE_WEIGHT: readonly number[] = [1, 2, 3, 2, 1]

/** A coin value the demo bankroll can afford, weighted toward the middle of the five denominations. */
export function attractCoinValue(rng: () => number, bankroll: number): CoinValue {
  const affordable = COIN_VALUES.filter((value) => value * LINE_COUNT <= bankroll)
  if (affordable.length === 0) return COIN_VALUES[0]!

  const weights = affordable.map((value) => MIDDLE_WEIGHT[COIN_VALUES.indexOf(value)]!)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let roll = rng() * total
  for (let i = 0; i < affordable.length; i++) {
    roll -= weights[i]!
    if (roll <= 0) return affordable[i]!
  }
  return affordable[affordable.length - 1]!
}
