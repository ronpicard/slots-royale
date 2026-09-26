import test from 'node:test'
import assert from 'node:assert/strict'
import { REEL_COUNT } from './types.ts'
import { REEL_STRIPS, SYMBOL_ORDER, stopsFor, windowFor } from './reels.ts'

const PAYING_SYMBOLS = SYMBOL_ORDER.filter((symbol) => symbol !== 'wild' && symbol !== 'scatter')

test('there are five strips, each a different length between 30 and 34', () => {
  assert.equal(REEL_STRIPS.length, REEL_COUNT)
  const lengths = REEL_STRIPS.map((strip) => strip.length)
  for (const length of lengths) assert.ok(length >= 30 && length <= 34, `length ${length} out of range`)
  assert.equal(new Set(lengths).size, lengths.length, 'strip lengths must all differ')
})

test('every strip contains every paying symbol', () => {
  for (const strip of REEL_STRIPS) {
    for (const symbol of PAYING_SYMBOLS) assert.ok(strip.includes(symbol), `missing ${symbol}`)
  }
})

test('the wild appears only on reels 1 to 3, once or twice per strip', () => {
  REEL_STRIPS.forEach((strip, reel) => {
    const count = strip.filter((symbol) => symbol === 'wild').length
    if (reel === 0 || reel === REEL_STRIPS.length - 1) assert.equal(count, 0, `reel ${reel} should have no wild`)
    else assert.ok(count === 1 || count === 2, `reel ${reel} wild count ${count}`)
  })
})

test('every strip has exactly one scatter and one or two sevens', () => {
  for (const strip of REEL_STRIPS) {
    assert.equal(strip.filter((symbol) => symbol === 'scatter').length, 1)
    const sevens = strip.filter((symbol) => symbol === 'seven').length
    assert.ok(sevens === 1 || sevens === 2)
  }
})

test('windowFor reads stop, stop+1, stop+2 top to bottom and wraps at the strip end', () => {
  const stops = REEL_STRIPS.map((strip) => strip.length - 1)
  const win = windowFor(stops)
  REEL_STRIPS.forEach((strip, reel) => {
    assert.equal(win[reel]![0], strip[strip.length - 1])
    assert.equal(win[reel]![1], strip[0])
    assert.equal(win[reel]![2], strip[1])
  })
})

test('windowFor reads three consecutive symbols for an interior stop', () => {
  const stops = REEL_STRIPS.map(() => 2)
  const win = windowFor(stops)
  REEL_STRIPS.forEach((strip, reel) => {
    assert.deepEqual(win[reel], [strip[2], strip[3], strip[4]])
  })
})

test('stopsFor is deterministic for a seed and always in range', () => {
  function fakeRng(values: readonly number[]): () => number {
    let i = 0
    return () => values[i++]!
  }
  const values = [0.1, 0.5, 0.9, 0.2, 0.7]
  const a = stopsFor(fakeRng(values))
  const b = stopsFor(fakeRng(values))
  assert.deepEqual(a, b)
  a.forEach((stop, reel) => {
    assert.ok(stop >= 0 && stop < REEL_STRIPS[reel]!.length)
    assert.equal(stop, Math.floor(values[reel]! * REEL_STRIPS[reel]!.length))
  })
})
