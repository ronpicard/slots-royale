import test from 'node:test'
import assert from 'node:assert/strict'
import type { CoinValue, SymbolId } from './types.ts'
import { REEL_COUNT } from './types.ts'
import { PAYTABLE, SCATTER_FREE_SPINS, SCATTER_PAYS, evaluate } from './paytable.ts'

const COIN_VALUE: CoinValue = 1
const BET = COIN_VALUE * 20 // LINE_COUNT

/**
 * A background where every column is a single symbol (same value in every row). No line can ever
 * match 2 or more consecutive reels from this alone: consecutive reels always differ. Tests layer
 * their own symbols on top of specific cells without worrying the filler will also pay.
 */
const FILLER: readonly SymbolId[] = ['plum', 'orange', 'lemon', 'cherry', 'diamond']

function fillerWindow(): SymbolId[][] {
  return FILLER.map((symbol) => [symbol, symbol, symbol])
}

/** The full window with every cell the same symbol: every line evaluates identically. */
function uniformWindow(symbol: SymbolId): SymbolId[][] {
  return Array.from({ length: REEL_COUNT }, () => [symbol, symbol, symbol])
}

/** Places `symbols` (one per reel) on the middle row (line 0), leaving the filler elsewhere. */
function middleRowWindow(symbols: readonly SymbolId[]): SymbolId[][] {
  const window = fillerWindow()
  symbols.forEach((symbol, reel) => {
    window[reel]![1] = symbol
  })
  return window
}

function line0Win(window: SymbolId[][], coinValue = COIN_VALUE, multiplier = 1) {
  return evaluate(window, coinValue, multiplier).lineWins.find((win) => win.line === 0)
}

test('a middle-row 5 sevens is a jackpot paying 1000 x coin', () => {
  const result = evaluate(uniformWindow('seven'), COIN_VALUE, 1)
  assert.equal(result.tier, 'jackpot')
  const win = result.lineWins.find((w) => w.line === 0)!
  assert.equal(win.symbol, 'seven')
  assert.equal(win.count, 5)
  assert.equal(win.payout, 1000 * COIN_VALUE)
})

test('the wild substitutes for a paying symbol', () => {
  const win = line0Win(middleRowWindow(['wild', 'cherry', 'cherry', 'cherry', 'diamond']))!
  assert.equal(win.symbol, 'cherry')
  assert.equal(win.count, 4)
  assert.equal(win.payout, PAYTABLE.cherry[1] * COIN_VALUE)
})

test('a line of five wilds pays as five sevens', () => {
  const result = evaluate(uniformWindow('wild'), COIN_VALUE, 1)
  assert.equal(result.tier, 'jackpot')
  for (const win of result.lineWins) {
    assert.equal(win.symbol, 'seven')
    assert.equal(win.count, 5)
    assert.equal(win.payout, 1000 * COIN_VALUE)
  }
})

test('2 matching symbols pay nothing', () => {
  const win = line0Win(middleRowWindow(['bar', 'bar', 'diamond', 'plum', 'lemon']))
  assert.equal(win, undefined)
})

test('a line pays only for its highest run: 4 cherries, not 3', () => {
  const win = line0Win(middleRowWindow(['cherry', 'cherry', 'cherry', 'cherry', 'bar']))!
  assert.equal(win.count, 4)
  assert.equal(win.payout, PAYTABLE.cherry[1] * COIN_VALUE)
  assert.notEqual(win.payout, PAYTABLE.cherry[0] * COIN_VALUE)
})

test('a mixed win of two lines adds', () => {
  // Top row all bell, middle row all bar, bottom row a non-matching filler: only line 0 (middle)
  // and line 1 (top) can possibly win here.
  const window: SymbolId[][] = Array.from({ length: REEL_COUNT }, (_, reel) => ['bell', 'bar', FILLER[reel]!])
  const result = evaluate(window, COIN_VALUE, 1)
  assert.equal(result.lineWins.length, 2)
  const middle = result.lineWins.find((w) => w.line === 0)!
  const top = result.lineWins.find((w) => w.line === 1)!
  assert.equal(middle.symbol, 'bar')
  assert.equal(middle.payout, PAYTABLE.bar[2] * COIN_VALUE)
  assert.equal(top.symbol, 'bell')
  assert.equal(top.payout, PAYTABLE.bell[2] * COIN_VALUE)
  assert.equal(result.totalWin, middle.payout + top.payout)
})

test('3 scatters anywhere pay 2x the total bet and award 10 free spins, regardless of position', () => {
  const window = fillerWindow()
  window[0]![0] = 'scatter'
  window[2]![1] = 'scatter'
  window[4]![2] = 'scatter'
  const result = evaluate(window, COIN_VALUE, 1)
  assert.equal(result.lineWins.length, 0)
  assert.ok(result.scatter)
  assert.equal(result.scatter!.count, 3)
  assert.equal(result.scatter!.payout, SCATTER_PAYS[0] * BET)
  assert.equal(result.scatter!.freeSpins, SCATTER_FREE_SPINS[0])
  assert.equal(result.totalWin, SCATTER_PAYS[0] * BET)
})

test('4 and 5 scatters scale the payout and the free spins', () => {
  const fourWindow = fillerWindow()
  fourWindow[0]![0] = 'scatter'
  fourWindow[1]![1] = 'scatter'
  fourWindow[2]![2] = 'scatter'
  fourWindow[3]![0] = 'scatter'
  const four = evaluate(fourWindow, COIN_VALUE, 1).scatter!
  assert.equal(four.payout, SCATTER_PAYS[1] * BET)
  assert.equal(four.freeSpins, SCATTER_FREE_SPINS[1])

  const fiveWindow = fourWindow.map((column) => [...column])
  fiveWindow[4]![1] = 'scatter'
  const five = evaluate(fiveWindow, COIN_VALUE, 1).scatter!
  assert.equal(five.payout, SCATTER_PAYS[2] * BET)
  assert.equal(five.freeSpins, SCATTER_FREE_SPINS[2])
})

test('the multiplier doubles every win', () => {
  const window: SymbolId[][] = Array.from({ length: REEL_COUNT }, (_, reel) => ['bell', 'bar', FILLER[reel]!])
  const single = evaluate(window, COIN_VALUE, 1).totalWin
  const doubled = evaluate(window, COIN_VALUE, 2).totalWin
  assert.equal(doubled, single * 2)
})

test('tier is none when nothing pays', () => {
  const result = evaluate(fillerWindow(), COIN_VALUE, 1)
  assert.equal(result.totalWin, 0)
  assert.equal(result.tier, 'none')
})

test('tier is small for a modest win under 10x the bet', () => {
  const win = middleRowWindow(['bar', 'bar', 'bar', 'orange', 'lemon'])
  const result = evaluate(win, COIN_VALUE, 1)
  assert.equal(result.totalWin, PAYTABLE.bar[0] * COIN_VALUE)
  assert.ok(result.totalWin > 0 && result.totalWin < BET * 10)
  assert.equal(result.tier, 'small')
})

test('tier is big for a win at least 10x but under 25x the bet', () => {
  const result = evaluate(middleRowWindow(['bar', 'bar', 'bar', 'bar', 'bar']), COIN_VALUE, 1)
  assert.equal(result.lineWins.length, 1)
  assert.ok(result.totalWin >= BET * 10 && result.totalWin < BET * 25)
  assert.equal(result.tier, 'big')
})

test('tier is mega for a win at least 25x the bet that is not five sevens', () => {
  const window: SymbolId[][] = Array.from({ length: REEL_COUNT }, (_, reel) => ['bell', 'bar', FILLER[reel]!])
  const result = evaluate(window, COIN_VALUE, 2)
  assert.ok(result.totalWin >= BET * 25)
  assert.equal(result.tier, 'mega')
  assert.notEqual(result.tier, 'jackpot')
})
