/**
 * How the crowd around the machine reacts to a spin. A pure function of a `SpinOutcome`, so the
 * engine, the crowd view and the audio all agree.
 */

import type { SpinOutcome } from './types.ts'

export type CrowdReactionKind = 'cheer' | 'groan'

export interface CrowdReaction {
  kind: CrowdReactionKind
  /** 0 to 1: how many spectators join in and how loudly. */
  strength: number
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * Jackpot and mega wins draw the loudest cheer, big wins a bit less, and a small win only when it
 * covers the bet; a smaller win draws no reaction at all. Awarding free spins always draws a
 * cheer, ranked between the big and mega cheers. No win draws a soft groan that grows with the
 * size of the bet that was lost.
 */
export function crowdReaction(outcome: SpinOutcome | null): CrowdReaction | null {
  if (!outcome) return null

  if (outcome.tier === 'jackpot' || outcome.tier === 'mega') return { kind: 'cheer', strength: 1 }

  const awardedFreeSpins = (outcome.scatter?.freeSpins ?? 0) > 0
  if (awardedFreeSpins) return { kind: 'cheer', strength: 0.9 }

  if (outcome.tier === 'big') return { kind: 'cheer', strength: 0.75 }

  if (outcome.tier === 'small') {
    if (outcome.totalWin >= outcome.bet) return { kind: 'cheer', strength: 0.4 }
    return null
  }

  return { kind: 'groan', strength: 0.2 + 0.3 * clamp01(outcome.bet / 500) }
}
