import test from 'node:test'
import assert from 'node:assert/strict'
import type { SpinOutcome } from './types.ts'
import { crowdReaction } from './crowd.ts'

function outcome(partial: Partial<SpinOutcome>): SpinOutcome {
  return {
    stops: [0, 0, 0, 0, 0],
    window: [],
    lineWins: [],
    scatter: null,
    totalWin: 0,
    tier: 'none',
    free: false,
    bet: 20,
    ...partial,
  }
}

test('jackpot and mega wins draw the loudest cheer', () => {
  assert.deepEqual(crowdReaction(outcome({ tier: 'jackpot', totalWin: 20000 })), { kind: 'cheer', strength: 1 })
  assert.deepEqual(crowdReaction(outcome({ tier: 'mega', totalWin: 600 })), { kind: 'cheer', strength: 1 })
})

test('a big win draws a strong cheer', () => {
  assert.deepEqual(crowdReaction(outcome({ tier: 'big', totalWin: 250 })), { kind: 'cheer', strength: 0.75 })
})

test('a small win that covers the bet draws a modest cheer', () => {
  const reaction = crowdReaction(outcome({ tier: 'small', totalWin: 20, bet: 20 }))
  assert.deepEqual(reaction, { kind: 'cheer', strength: 0.4 })
})

test('a small win below the bet draws no reaction', () => {
  assert.equal(crowdReaction(outcome({ tier: 'small', totalWin: 5, bet: 20 })), null)
})

test('no win draws a groan that grows with the size of the bet', () => {
  const small = crowdReaction(outcome({ tier: 'none', totalWin: 0, bet: 20 }))!
  const big = crowdReaction(outcome({ tier: 'none', totalWin: 0, bet: 500 }))!
  assert.equal(small.kind, 'groan')
  assert.equal(big.kind, 'groan')
  assert.ok(big.strength > small.strength)
})

test('awarding free spins draws a strong cheer even without a big line win', () => {
  const reaction = crowdReaction(
    outcome({ tier: 'small', totalWin: 40, bet: 20, scatter: { count: 3, payout: 40, freeSpins: 10, cells: [] } }),
  )
  assert.deepEqual(reaction, { kind: 'cheer', strength: 0.9 })
})
