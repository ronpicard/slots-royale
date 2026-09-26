import test from 'node:test'
import assert from 'node:assert/strict'
import { attractCoinValue } from './autoplay.ts'
import { COIN_VALUES } from './session.ts'
import { LINE_COUNT } from './types.ts'
import { createRng } from './rng.ts'

test('attractCoinValue only ever returns a value the bankroll can afford', () => {
  const rng = createRng(1)
  const bankroll = 3 * LINE_COUNT // affords 1 and 2, not 5, 10 or 25
  for (let i = 0; i < 200; i++) {
    const value = attractCoinValue(rng, bankroll)
    assert.ok(value * LINE_COUNT <= bankroll, `${value} unaffordable at bankroll ${bankroll}`)
  }
})

test('attractCoinValue is deterministic for a seed and covers more than one denomination over many draws', () => {
  const values = new Set<number>()
  const rngA = createRng(7)
  const rngB = createRng(7)
  for (let i = 0; i < 100; i++) {
    const a = attractCoinValue(rngA, 100_000)
    const b = attractCoinValue(rngB, 100_000)
    assert.equal(a, b)
    values.add(a)
  }
  assert.ok(values.size > 1, 'expected more than one denomination across 100 draws')
  for (const value of values) assert.ok((COIN_VALUES as readonly number[]).includes(value))
})
