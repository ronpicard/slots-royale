/**
 * Runs a batch of headless spins through the real game rules at coin value 1 with an unlimited
 * bankroll, and prints the realised return to player split into base-game and free-spin
 * contribution, the hit frequency, the free-spin trigger rate, the jackpot count, win-tier counts
 * and the biggest win. Tune `REEL_STRIPS` (in `src/game/reels.ts`) against this until the overall
 * RTP lands between 94% and 97%.
 *
 * Usage: `node --experimental-strip-types scripts/simulate.ts [spinCount]` (default 200000 spins).
 */

import { createSession, settle, spin } from '../src/game/session.ts'
import type { WinTier } from '../src/game/types.ts'

const DEFAULT_SPIN_COUNT = 200_000
/** Large enough that no spin is ever refused for lack of credits, without overflowing anything. */
const UNLIMITED_BANKROLL = 1e15
/** Spread out seeds so nearby spins don't share reel-strip phase. */
const SEED_STRIDE = 7919

const spinCount = Number(process.argv[2] ?? DEFAULT_SPIN_COUNT)

console.log(`Simulating ${spinCount} spins...\n`)

let session = { ...createSession(null), bankroll: UNLIMITED_BANKROLL }

let baseBet = 0
let baseWon = 0
let freeWon = 0
let hits = 0
let freeSpinTriggers = 0
let jackpots = 0
let biggestWin = 0
const tierCounts: Record<WinTier, number> = { none: 0, small: 0, big: 0, mega: 0, jackpot: 0 }

for (let i = 0; i < spinCount; i++) {
  const seed = 1000 + i * SEED_STRIDE
  session = spin(session, seed).session
  if (session.phase !== 'spinning') throw new Error(`spin refused at index ${i} (unexpected with an unlimited bankroll)`)

  const outcome = session.lastOutcome!
  session = settle(session).session

  if (outcome.free) freeWon += outcome.totalWin
  else {
    baseBet += outcome.bet
    baseWon += outcome.totalWin
  }
  if (outcome.totalWin > 0) hits++
  if ((outcome.scatter?.freeSpins ?? 0) > 0) freeSpinTriggers++
  if (outcome.tier === 'jackpot') jackpots++
  biggestWin = Math.max(biggestWin, outcome.totalWin)
  tierCounts[outcome.tier]++
}

const totalWon = baseWon + freeWon
const rtp = baseBet > 0 ? totalWon / baseBet : 0
const baseRtp = baseBet > 0 ? baseWon / baseBet : 0
const freeRtp = baseBet > 0 ? freeWon / baseBet : 0
const hitFrequency = hits / spinCount
const freeSpinRate = freeSpinTriggers > 0 ? spinCount / freeSpinTriggers : Infinity

console.log('Return to player (against base-game bet; free spins take no additional bet):')
console.log(`  overall RTP: ${(rtp * 100).toFixed(2)}%`)
console.log(`  base game:   ${(baseRtp * 100).toFixed(2)}%`)
console.log(`  free spins:  ${(freeRtp * 100).toFixed(2)}%`)
console.log(`  hit frequency: ${(hitFrequency * 100).toFixed(2)}%`)
console.log(`  free-spin trigger rate: 1 in ${freeSpinRate.toFixed(0)} spins`)
console.log(`  jackpots: ${jackpots}`)
console.log(`  biggest win: ${biggestWin.toFixed(0)}`)
console.log('Win tiers:')
for (const tier of ['small', 'big', 'mega', 'jackpot'] as const) {
  console.log(`  ${tier}: ${tierCounts[tier]} (${((tierCounts[tier] / spinCount) * 100).toFixed(3)}%)`)
}
