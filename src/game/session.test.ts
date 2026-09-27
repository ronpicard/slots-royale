import test from 'node:test'
import assert from 'node:assert/strict'
import type { Session, SessionSave, SessionStats, SpinOutcome } from './types.ts'
import { LINE_COUNT } from './types.ts'
import {
  COIN_VALUES,
  HISTORY_LENGTH,
  STARTING_BANKROLL,
  betDown,
  betUp,
  canBetUp,
  createSession,
  isBroke,
  maxBet,
  parseSessionSave,
  refill,
  setAutoplay,
  setCoinValue,
  settle,
  shouldAutoSpin,
  spin,
  toSave,
  totalBet,
} from './session.ts'

function freshSession(): Session {
  return createSession(null)
}

function spinAndSettle(s: Session, seed: number): Session {
  const spun = spin(s, seed)
  assert.equal(spun.session.phase, 'spinning', 'spin should have been accepted')
  return settle(spun.session).session
}

test('setCoinValue changes the coin value in idle or result, and is rejected while spinning', () => {
  const s0 = freshSession()
  const t1 = setCoinValue(s0, 10)
  assert.equal(t1.session.coinValue, 10)
  assert.ok(t1.commands.some((c) => c.type === 'sound' && c.name === 'betChange'))
  assert.ok(t1.commands.some((c) => c.type === 'save'))

  const spinning = spin(t1.session, 1).session
  assert.equal(spinning.phase, 'spinning')
  const rejected = setCoinValue(spinning, 25)
  assert.deepEqual(rejected.session, spinning)
  assert.deepEqual(rejected.commands, [])
})

test('setCoinValue is a no-op for the same value', () => {
  const s0 = freshSession()
  const same = setCoinValue(s0, s0.coinValue)
  assert.deepEqual(same, { session: s0, commands: [] })
})

test('betUp and betDown step through COIN_VALUES and clamp at the ends', () => {
  const s0 = freshSession()
  assert.equal(s0.coinValue, COIN_VALUES[0])

  const downAtFloor = betDown(s0)
  assert.equal(downAtFloor.session.coinValue, COIN_VALUES[0])

  let s = s0
  for (const value of COIN_VALUES.slice(1)) {
    s = betUp(s).session
    assert.equal(s.coinValue, value)
  }
  const upAtCeiling = betUp(s)
  assert.equal(upAtCeiling.session.coinValue, COIN_VALUES[COIN_VALUES.length - 1])

  const steppedDown = betDown(s).session
  assert.equal(steppedDown.coinValue, COIN_VALUES[COIN_VALUES.length - 2])
})

test('maxBet jumps straight to the highest coin value', () => {
  const t = maxBet(freshSession())
  assert.equal(t.session.coinValue, COIN_VALUES[COIN_VALUES.length - 1])
})

test('betUp refuses a coin whose total bet would exceed the bankroll', () => {
  const s0: Session = { ...setCoinValue(freshSession(), 5).session, bankroll: 150 }
  const t = betUp(s0)
  assert.equal(t.session.coinValue, 5, '10 x 20 lines = 200, more than the 150 bankroll')
  assert.deepEqual(t.commands, [])
})

test('betUp still raises the coin value when the next one is affordable', () => {
  const s0: Session = { ...setCoinValue(freshSession(), 5).session, bankroll: 300 }
  const t = betUp(s0)
  assert.equal(t.session.coinValue, 10)
})

test('maxBet picks the largest affordable coin, and does nothing when broke', () => {
  const affordable: Session = { ...freshSession(), bankroll: 450 }
  assert.equal(maxBet(affordable).session.coinValue, 10, '10 x 20 = 200 fits in 450, 25 x 20 = 500 does not')

  const broke: Session = { ...freshSession(), bankroll: 5 }
  assert.deepEqual(maxBet(broke), { session: broke, commands: [] })
})

test('canBetUp is false at the cap, false while spinning, and true below the cap when affordable', () => {
  const atCap: Session = { ...freshSession(), coinValue: 25 }
  assert.equal(canBetUp(atCap), false)

  const spinning: Session = { ...freshSession(), phase: 'spinning' }
  assert.equal(canBetUp(spinning), false)

  const belowCap: Session = { ...freshSession(), coinValue: 5, bankroll: 300 }
  assert.equal(canBetUp(belowCap), true)
})

test('totalBet is the coin value times the line count', () => {
  const s = setCoinValue(freshSession(), 5).session
  assert.equal(totalBet(s), 5 * LINE_COUNT)
})

test('spin deducts the total bet from the bankroll and is refused when the bankroll is too small', () => {
  const s0 = setCoinValue(freshSession(), 25).session
  const bet = totalBet(s0)
  const t = spin(s0, 42)
  assert.equal(t.session.phase, 'spinning')
  assert.equal(t.session.bankroll, s0.bankroll - bet)
  assert.ok(t.commands.some((c) => c.type === 'sound' && c.name === 'spinStart'))
  assert.ok(t.commands.some((c) => c.type === 'spin'))

  const poor: Session = { ...s0, bankroll: bet - 1 }
  const refused = spin(poor, 42)
  assert.deepEqual(refused.session, poor)
  assert.deepEqual(refused.commands, [])
})

test('spin is a no-op while already spinning', () => {
  const spinning = spin(freshSession(), 1).session
  const again = spin(spinning, 2)
  assert.deepEqual(again.session, spinning)
})

test('settle pays the total win into the bankroll and moves to result', () => {
  const spinning = spin(freshSession(), 7).session
  const settled = settle(spinning)
  assert.equal(settled.session.phase, 'result')
  assert.equal(settled.session.bankroll, spinning.bankroll + spinning.lastOutcome!.totalWin)
  assert.ok(settled.commands.some((c) => c.type === 'save'))
})

test('settle is a no-op outside the spinning phase', () => {
  const s0 = freshSession()
  const t = settle(s0)
  assert.deepEqual(t.session, s0)
})

test('settle lowers the coin to the largest affordable, stops autoplay, and emits a message when a losing spin leaves the bankroll below the bet', () => {
  const bet = 10 * LINE_COUNT
  const outcome: SpinOutcome = {
    stops: [0, 0, 0, 0, 0],
    window: [[], [], [], [], []],
    lineWins: [],
    scatter: null,
    totalWin: 0,
    tier: 'none',
    free: false,
    bet,
  }
  const spinning: Session = {
    ...setAutoplay(freshSession(), 5).session,
    phase: 'spinning',
    coinValue: 10,
    bankroll: 150, // the bet was already taken off before spinning; 150 can no longer cover 200
    lastOutcome: outcome,
  }
  const settled = settle(spinning)
  assert.equal(settled.session.coinValue, 5, '5 x 20 = 100 is the largest total bet that fits in 150')
  assert.equal(settled.session.autoplayRemaining, 0)
  assert.ok(settled.commands.some((c) => c.type === 'message' && /Bet lowered to 100/.test(c.text)))
})

test('settle leaves the coin alone during a free-spin bonus and when broke', () => {
  const bonusOutcome: SpinOutcome = {
    stops: [0, 0, 0, 0, 0],
    window: [[], [], [], [], []],
    lineWins: [],
    scatter: null,
    totalWin: 0,
    tier: 'none',
    free: true,
    bet: 100,
  }
  const spinningBonus: Session = {
    ...freshSession(),
    phase: 'spinning',
    coinValue: 25,
    bankroll: 10,
    freeSpins: { remaining: 2, total: 2, won: 0, multiplier: 2, bet: 100 },
    lastOutcome: bonusOutcome,
  }
  const settledBonus = settle(spinningBonus)
  assert.equal(settledBonus.session.coinValue, 25, 'coin value is untouched during a bonus, however small the bankroll')
  assert.ok(settledBonus.session.freeSpins !== null)

  const brokeOutcome: SpinOutcome = {
    stops: [0, 0, 0, 0, 0],
    window: [[], [], [], [], []],
    lineWins: [],
    scatter: null,
    totalWin: 0,
    tier: 'none',
    free: false,
    bet: 100,
  }
  const spinningBroke: Session = {
    ...freshSession(),
    phase: 'spinning',
    coinValue: 5,
    bankroll: 0,
    lastOutcome: brokeOutcome,
  }
  const settledBroke = settle(spinningBroke)
  assert.equal(settledBroke.session.coinValue, 5, 'no coin value is affordable, so refill takes over instead')
  assert.ok(!settledBroke.commands.some((c) => c.type === 'message' && /Bet lowered/.test(c.text)))
})

test('a free spin takes no bet, doubles the multiplier, and reports free: true', () => {
  const s0 = freshSession()
  const withBonus: Session = {
    ...s0,
    freeSpins: { remaining: 3, total: 3, won: 0, multiplier: 2, bet: 100 },
  }
  const t = spin(withBonus, 99)
  assert.equal(t.session.phase, 'spinning')
  assert.equal(t.session.bankroll, withBonus.bankroll, 'no bet taken during a free spin')
  assert.equal(t.session.lastOutcome!.free, true)
  assert.equal(t.session.lastOutcome!.bet, 100)
})

test('settling a free spin decrements remaining and accumulates won', () => {
  const withBonus: Session = {
    ...freshSession(),
    freeSpins: { remaining: 2, total: 2, won: 0, multiplier: 2, bet: 100 },
  }
  const spinning = spin(withBonus, 5).session
  const settled = settle(spinning).session
  assert.equal(settled.freeSpins!.remaining, 1)
  assert.equal(settled.freeSpins!.won, spinning.lastOutcome!.totalWin)
  assert.equal(settled.freeSpins!.total, 2)
})

test('free spins end and clear, reporting freeSpinsOver with the total won', () => {
  const withBonus: Session = {
    ...freshSession(),
    freeSpins: { remaining: 1, total: 5, won: 40, multiplier: 2, bet: 100 },
  }
  const spinning = spin(withBonus, 5).session
  const settled = settle(spinning)
  assert.equal(settled.session.freeSpins, null)
  const over = settled.commands.find((c) => c.type === 'freeSpinsOver')
  assert.ok(over)
  assert.equal((over as { won: number }).won, 40 + spinning.lastOutcome!.totalWin)
  assert.ok(settled.commands.some((c) => c.type === 'message' && /Free spins won/.test(c.text)))
})

test('a scatter win awards free spins and can retrigger an existing bonus', () => {
  // Search a small range of seeds for one that lands a fresh scatter trigger, and another that
  // lands one while already inside a bonus (a retrigger). Deterministic, no time limit risk: the
  // reels are dense enough with scatters that both show up within a modest range.
  let triggerSeed = -1
  for (let seed = 0; seed < 2000; seed++) {
    const t = spin(freshSession(), seed)
    const outcome = t.session.lastOutcome!
    if ((outcome.scatter?.freeSpins ?? 0) > 0) {
      triggerSeed = seed
      break
    }
  }
  assert.ok(triggerSeed >= 0, 'expected to find a scatter trigger within 2000 seeds')

  const spinning = spin(freshSession(), triggerSeed).session
  const settledTransition = settle(spinning)
  assert.ok(settledTransition.session.freeSpins !== null)
  assert.equal(settledTransition.session.freeSpins!.remaining, settledTransition.session.freeSpins!.total)
  const awarded = settledTransition.commands.find((c) => c.type === 'freeSpinsAwarded')
  assert.ok(awarded)

  // Retrigger: force an existing bonus, then settle a spin whose outcome we already know triggers.
  const bonus: Session = { ...freshSession(), freeSpins: { remaining: 2, total: 2, won: 0, multiplier: 2, bet: 20 } }
  const spinningInBonus = spin(bonus, triggerSeed).session
  const outcome = spinningInBonus.lastOutcome!
  assert.ok((outcome.scatter?.freeSpins ?? 0) > 0)
  const settledInBonus = settle(spinningInBonus).session
  assert.ok(settledInBonus.freeSpins !== null)
  assert.equal(settledInBonus.freeSpins!.total, 2 + outcome.scatter!.freeSpins)
})

test('setAutoplay sets the remaining count, rejected while spinning, and spin counts it down', () => {
  const t = setAutoplay(freshSession(), 25)
  assert.equal(t.session.autoplayRemaining, 25)

  const spinning = spin(freshSession(), 1).session
  const rejected = setAutoplay(spinning, 10)
  assert.deepEqual(rejected.session, spinning)

  const withAutoplay = setAutoplay(freshSession(), 5).session
  const spun = spin(withAutoplay, 1)
  assert.equal(spun.session.autoplayRemaining, 4)
})

test('autoplay does not count down during a free spin', () => {
  const withBoth: Session = {
    ...setAutoplay(freshSession(), 5).session,
    freeSpins: { remaining: 3, total: 3, won: 0, multiplier: 2, bet: 100 },
  }
  const spun = spin(withBoth, 1)
  assert.equal(spun.session.autoplayRemaining, 5)
})

test('shouldAutoSpin is true during free spins, true when autoplay can afford a spin, false otherwise', () => {
  const s0 = freshSession()
  assert.equal(shouldAutoSpin(s0), false)

  const withBonus: Session = { ...s0, freeSpins: { remaining: 1, total: 1, won: 0, multiplier: 2, bet: 20 } }
  assert.equal(shouldAutoSpin(withBonus), true)

  const withAutoplay = setAutoplay(s0, 3).session
  assert.equal(shouldAutoSpin(withAutoplay), true)

  const brokeAutoplay: Session = { ...withAutoplay, bankroll: 0 }
  assert.equal(shouldAutoSpin(brokeAutoplay), false)
})

test('history unshifts the total win (0 for a loss) and caps at HISTORY_LENGTH', () => {
  let s = { ...freshSession(), bankroll: 1_000_000 }
  for (let i = 0; i < HISTORY_LENGTH + 10; i++) {
    s = spinAndSettle(s, i)
  }
  assert.equal(s.history.length, HISTORY_LENGTH)
  const last = spinAndSettle(s, 999999)
  assert.equal(last.history[0], last.lastOutcome!.totalWin)
})

test('stats accumulate spins, bet, winnings, biggest win, free spins played and jackpots', () => {
  let s = freshSession()
  for (let i = 0; i < 50; i++) s = spinAndSettle(s, i)
  assert.equal(s.stats.spins, 50)
  assert.ok(s.stats.totalBet > 0)
  assert.ok(s.stats.totalWon >= 0)
  assert.ok(s.stats.biggestWin >= 0)
  assert.ok(s.stats.peakBankroll >= STARTING_BANKROLL)
})

test('isBroke is true under the minimum bet with no free spins, false during a bonus', () => {
  const s0 = freshSession()
  assert.equal(isBroke(s0), false)

  const broke: Session = { ...s0, bankroll: 19 }
  assert.equal(isBroke(broke), true)

  const brokeButBonus: Session = { ...broke, freeSpins: { remaining: 1, total: 1, won: 0, multiplier: 2, bet: 20 } }
  assert.equal(isBroke(brokeButBonus), false)
})

test('refill restores the starting bankroll only when broke', () => {
  const s0 = freshSession()
  const notBroke = refill(s0)
  assert.deepEqual(notBroke.session, s0)

  const broke: Session = { ...s0, bankroll: 0 }
  const refilled = refill(broke)
  assert.equal(refilled.session.bankroll, STARTING_BANKROLL)
  assert.ok(refilled.commands.some((c) => c.type === 'sound' && c.name === 'refill'))
  assert.ok(refilled.commands.some((c) => c.type === 'save'))
})

test('toSave and parseSessionSave round-trip', () => {
  let s = setCoinValue(freshSession(), 10).session
  s = spinAndSettle(s, 3)
  s = spinAndSettle(s, 4)

  const save = toSave(s)
  assert.equal(save.version, 1)
  assert.equal(save.coinValue, 10)
  const parsed = parseSessionSave(save)
  assert.deepEqual(parsed, save)

  const restored = createSession(parsed)
  assert.equal(restored.bankroll, save.bankroll)
  assert.equal(restored.coinValue, save.coinValue)
  assert.deepEqual(restored.history, save.history)
  assert.deepEqual(restored.stats, save.stats)
})

test('createSession clamps a saved coin value the saved bankroll cannot cover', () => {
  const stats: SessionStats = { spins: 0, totalBet: 0, totalWon: 0, biggestWin: 0, freeSpinsPlayed: 0, jackpots: 0, peakBankroll: 300 }
  const save: SessionSave = { version: 1, bankroll: 300, coinValue: 25, history: [], stats }
  const restored = createSession(save)
  assert.equal(restored.coinValue, 10, '10 x 20 = 200 fits in 300, 25 x 20 = 500 does not')
  assert.equal(restored.bankroll, 300)
})

test('parseSessionSave rejects malformed data', () => {
  assert.equal(parseSessionSave(null), null)
  assert.equal(parseSessionSave(undefined), null)
  assert.equal(parseSessionSave('nope'), null)
  assert.equal(parseSessionSave(42), null)
  assert.equal(parseSessionSave({}), null)

  const base: SessionSave = {
    version: 1,
    bankroll: 1000,
    coinValue: 5,
    history: [0, 20, 0],
    stats: { spins: 3, totalBet: 60, totalWon: 20, biggestWin: 20, freeSpinsPlayed: 0, jackpots: 0, peakBankroll: 1000 },
  }
  assert.deepEqual(parseSessionSave(base), base)

  assert.equal(parseSessionSave({ ...base, version: 2 }), null)
  assert.equal(parseSessionSave({ ...base, bankroll: -5 }), null)
  assert.equal(parseSessionSave({ ...base, bankroll: 1.5 }), null)
  assert.equal(parseSessionSave({ ...base, coinValue: 3 }), null)
  assert.equal(parseSessionSave({ ...base, history: ['1', '2'] }), null)
  assert.equal(parseSessionSave({ ...base, stats: null }), null)
  assert.equal(parseSessionSave({ ...base, stats: { ...base.stats, spins: -1 } }), null)

  const longHistory = new Array(300).fill(5)
  assert.equal(parseSessionSave({ ...base, history: longHistory }), null)
})

test('the same seed always replays the same outcome', () => {
  const a = spin(freshSession(), 12345).session.lastOutcome
  const b = spin(freshSession(), 12345).session.lastOutcome
  assert.deepEqual(a, b)
})

test('Monte Carlo: 20,000 spins never throw, never go negative, and land in a plausible RTP and hit-frequency range', () => {
  let session = { ...createSession(null), bankroll: 1_000_000 }
  let wagered = 0
  let returned = 0
  let hits = 0
  const spins = 20_000

  for (let i = 0; i < spins; i++) {
    const spun = spin(session, i * 104729 + 17)
    assert.equal(spun.session.phase, 'spinning')
    session = spun.session
    const outcome = session.lastOutcome!
    if (!outcome.free) wagered += outcome.bet
    returned += outcome.totalWin
    if (outcome.totalWin > 0) hits++

    session = settle(session).session
    assert.ok(session.bankroll >= 0, `bankroll went negative at spin ${i}`)
  }

  const rtp = returned / wagered
  const hitFrequency = hits / spins
  assert.ok(rtp >= 0.9 && rtp <= 1.0, `RTP ${rtp} out of range`)
  assert.ok(hitFrequency >= 0.2 && hitFrequency <= 0.45, `hit frequency ${hitFrequency} out of range`)
})

test('spin saves the session with the stake already taken off the bankroll', () => {
  const s = freshSession()
  const t = spin(s, 5)
  assert.ok(t.commands.some((c) => c.type === 'save'))
  assert.equal(toSave(t.session).bankroll, STARTING_BANKROLL - totalBet(s))
})
