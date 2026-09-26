import test from 'node:test'
import assert from 'node:assert/strict'
import { LINE_COUNT } from './types.ts'
import { PAYLINES } from './paylines.ts'

test('there are twenty paylines, one row per reel', () => {
  assert.equal(PAYLINES.length, LINE_COUNT)
  for (const line of PAYLINES) assert.equal(line.length, 5)
})

test('every row index is 0, 1 or 2', () => {
  for (const line of PAYLINES) {
    for (const row of line) assert.ok(row === 0 || row === 1 || row === 2, `row ${row} out of range`)
  }
})

test('every line is distinct', () => {
  const seen = new Set(PAYLINES.map((line) => line.join(',')))
  assert.equal(seen.size, PAYLINES.length)
})

test('line 0 is the middle row straight across', () => {
  assert.deepEqual(PAYLINES[0], [1, 1, 1, 1, 1])
})
