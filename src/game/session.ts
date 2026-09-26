/**
 * Session rules: the pure state machine behind a play session (bankroll, coin value, free spins,
 * autoplay, history and stats). Every transition takes a `Session` and returns a new `Transition`
 * (a new `Session` plus the `Command`s the engine should run); nothing here mutates its input,
 * touches the DOM, or calls `Math.random`/`Date`.
 */

import type {
  Command,
  CoinValue,
  Session,
  SessionSave,
  SessionStats,
  SpinOutcome,
  Transition,
} from './types.ts'
import { LINE_COUNT } from './types.ts'
import { createRng } from './rng.ts'
import { stopsFor, windowFor } from './reels.ts'
import { FREE_SPIN_MULTIPLIER, evaluate } from './paytable.ts'

export const STARTING_BANKROLL = 1000
export const COIN_VALUES: readonly CoinValue[] = [1, 2, 5, 10, 25]
/** Most spins kept in `Session.history`. `toSave` caps further, at `SAVE_HISTORY_LENGTH`. */
export const HISTORY_LENGTH = 200
export const SAVE_HISTORY_LENGTH = 50

const FREE_SPINS_MESSAGE_SECONDS = 3

function noChange(session: Session): Transition {
  return { session, commands: [] }
}

function freshStats(): SessionStats {
  return { spins: 0, totalBet: 0, totalWon: 0, biggestWin: 0, freeSpinsPlayed: 0, jackpots: 0, peakBankroll: STARTING_BANKROLL }
}

/** Formats a whole number of credits with thousands separators, e.g. `1,250`. */
function formatCredits(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** Creates a fresh session, or restores one from a validated save. */
export function createSession(save: SessionSave | null): Session {
  return {
    phase: 'idle',
    bankroll: save ? save.bankroll : STARTING_BANKROLL,
    coinValue: save ? save.coinValue : 1,
    freeSpins: null,
    autoplayRemaining: 0,
    lastOutcome: null,
    history: save ? save.history.slice(0, HISTORY_LENGTH) : [],
    stats: save ? { ...save.stats } : freshStats(),
  }
}

/** What a spin at the current coin value costs. During free spins, the bonus itself plays at `freeSpins.bet`. */
export function totalBet(s: Session): number {
  return s.coinValue * LINE_COUNT
}

/** Sets the coin value per line. Only allowed outside a spin and outside a free-spin bonus. */
export function setCoinValue(s: Session, value: CoinValue): Transition {
  if (s.phase === 'spinning' || s.freeSpins !== null) return noChange(s)
  if (s.coinValue === value) return noChange(s)
  return {
    session: { ...s, coinValue: value },
    commands: [{ type: 'sound', name: 'betChange' }, { type: 'save' }],
  }
}

function stepCoinValue(s: Session, direction: 1 | -1): Transition {
  if (s.phase === 'spinning' || s.freeSpins !== null) return noChange(s)
  const index = COIN_VALUES.indexOf(s.coinValue)
  const nextIndex = Math.min(COIN_VALUES.length - 1, Math.max(0, index + direction))
  return setCoinValue(s, COIN_VALUES[nextIndex]!)
}

export function betUp(s: Session): Transition {
  return stepCoinValue(s, 1)
}

export function betDown(s: Session): Transition {
  return stepCoinValue(s, -1)
}

export function maxBet(s: Session): Transition {
  return setCoinValue(s, COIN_VALUES[COIN_VALUES.length - 1]!)
}

/** Sets the number of spins autoplay should still run by itself; 0 turns it off. */
export function setAutoplay(s: Session, count: number): Transition {
  if (s.phase === 'spinning') return noChange(s)
  const autoplayRemaining = Math.max(0, Math.floor(count))
  if (autoplayRemaining === s.autoplayRemaining) return noChange(s)
  return { session: { ...s, autoplayRemaining }, commands: [] }
}

/**
 * Spins the reels. Allowed from 'idle' or 'result'. During a free-spin bonus no bet is taken (the
 * bonus plays at its own bet, doubled); otherwise the total bet is deducted up front and the spin
 * is refused when the bankroll can't cover it.
 */
export function spin(s: Session, seed: number): Transition {
  if (s.phase === 'spinning') return noChange(s)

  const free = s.freeSpins !== null && s.freeSpins.remaining > 0
  const bet = free ? s.freeSpins!.bet : totalBet(s)
  const coinValue = (free ? bet / LINE_COUNT : s.coinValue) as CoinValue
  const multiplier = free ? FREE_SPIN_MULTIPLIER : 1

  if (!free && s.bankroll < bet) return noChange(s)

  const stops = stopsFor(createRng(seed))
  const window = windowFor(stops)
  const evaluated = evaluate(window, coinValue, multiplier)
  const outcome: SpinOutcome = { stops, window, ...evaluated, free, bet }

  const bankroll = free ? s.bankroll : s.bankroll - bet
  const autoplayRemaining = !free && s.autoplayRemaining > 0 ? s.autoplayRemaining - 1 : s.autoplayRemaining

  return {
    session: { ...s, phase: 'spinning', bankroll, lastOutcome: outcome, autoplayRemaining },
    // Persist the stake now so a reload mid-spin cannot refund a losing spin.
    commands: [{ type: 'sound', name: 'spinStart' }, { type: 'spin', outcome }, { type: 'save' }],
  }
}

/** Settles the spin in progress: pays out, updates free spins, history and stats. */
export function settle(s: Session): Transition {
  if (s.phase !== 'spinning' || s.lastOutcome === null) return noChange(s)
  const outcome = s.lastOutcome
  const commands: Command[] = []

  const bankroll = s.bankroll + outcome.totalWin

  let freeSpins = s.freeSpins
  if (outcome.free && freeSpins !== null) {
    freeSpins = { ...freeSpins, remaining: freeSpins.remaining - 1, won: freeSpins.won + outcome.totalWin }
  }

  const awarded = outcome.scatter?.freeSpins ?? 0
  if (awarded > 0) {
    freeSpins =
      freeSpins === null
        ? { remaining: awarded, total: awarded, won: 0, multiplier: FREE_SPIN_MULTIPLIER, bet: outcome.bet }
        : { ...freeSpins, remaining: freeSpins.remaining + awarded, total: freeSpins.total + awarded }
    commands.push({ type: 'freeSpinsAwarded', count: awarded, total: freeSpins.total })
    commands.push({ type: 'sound', name: 'freeSpins' })
    commands.push({ type: 'message', text: 'FREE SPINS', seconds: FREE_SPINS_MESSAGE_SECONDS })
  }

  let freeSpinsOverWon: number | null = null
  if (freeSpins !== null && freeSpins.remaining <= 0) {
    freeSpinsOverWon = freeSpins.won
    freeSpins = null
  }

  const history = [outcome.totalWin, ...s.history].slice(0, HISTORY_LENGTH)
  const stats: SessionStats = {
    spins: s.stats.spins + 1,
    totalBet: s.stats.totalBet + (outcome.free ? 0 : outcome.bet),
    totalWon: s.stats.totalWon + outcome.totalWin,
    biggestWin: Math.max(s.stats.biggestWin, outcome.totalWin),
    freeSpinsPlayed: s.stats.freeSpinsPlayed + (outcome.free ? 1 : 0),
    jackpots: s.stats.jackpots + (outcome.tier === 'jackpot' ? 1 : 0),
    peakBankroll: Math.max(s.stats.peakBankroll, bankroll),
  }

  if (freeSpinsOverWon !== null) {
    commands.push({ type: 'freeSpinsOver', won: freeSpinsOverWon })
    commands.push({ type: 'message', text: `Free spins won ${formatCredits(freeSpinsOverWon)}`, seconds: FREE_SPINS_MESSAGE_SECONDS })
  }

  switch (outcome.tier) {
    case 'jackpot':
      commands.push({ type: 'sound', name: 'jackpot' })
      break
    case 'mega':
      commands.push({ type: 'sound', name: 'winMega' })
      break
    case 'big':
      commands.push({ type: 'sound', name: 'winBig' })
      break
    case 'small':
      commands.push({ type: 'sound', name: 'winSmall' })
      break
    case 'none':
      break
  }
  if (outcome.totalWin > 0) commands.push({ type: 'sound', name: 'coinPayout' })
  commands.push({ type: 'save' })

  return {
    session: { ...s, phase: 'result', bankroll, freeSpins, lastOutcome: outcome, history, stats },
    commands,
  }
}

/** Restores the starting bankroll once the player is broke. */
export function refill(s: Session): Transition {
  if (!isBroke(s)) return noChange(s)
  return {
    session: { ...s, bankroll: STARTING_BANKROLL },
    commands: [{ type: 'sound', name: 'refill' }, { type: 'save' }],
  }
}

/** True when the player can't afford even the smallest spin and isn't mid a free-spin bonus. */
export function isBroke(s: Session): boolean {
  const minBet = COIN_VALUES[0]! * LINE_COUNT
  return s.freeSpins === null && s.bankroll < minBet
}

/** Whether the engine should spin again on its own: a free-spin bonus in progress, or autoplay that can still afford a spin. */
export function shouldAutoSpin(s: Session): boolean {
  if (s.freeSpins !== null && s.freeSpins.remaining > 0) return true
  return s.autoplayRemaining > 0 && s.bankroll >= totalBet(s)
}

/** What gets written to localStorage. */
export function toSave(s: Session): SessionSave {
  return {
    version: 1,
    bankroll: s.bankroll,
    coinValue: s.coinValue,
    history: s.history.slice(0, SAVE_HISTORY_LENGTH),
    stats: { ...s.stats },
  }
}

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0
}

/** Validates a value read from localStorage. Anything malformed becomes `null`. */
export function parseSessionSave(raw: unknown): SessionSave | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  if (value.version !== 1) return null

  const bankroll = value.bankroll
  if (!isFiniteNonNegative(bankroll) || !Number.isInteger(bankroll) || bankroll > 1e9) return null

  const coinValue = value.coinValue
  if (typeof coinValue !== 'number' || !COIN_VALUES.includes(coinValue as CoinValue)) return null

  const historyRaw = value.history
  if (!Array.isArray(historyRaw) || historyRaw.length > HISTORY_LENGTH) return null
  const history: number[] = []
  for (const n of historyRaw) {
    if (!isFiniteNonNegative(n)) return null
    history.push(n)
  }

  const statsRaw = value.stats
  if (typeof statsRaw !== 'object' || statsRaw === null) return null
  const stats = statsRaw as Record<string, unknown>
  const { spins, totalBet: statTotalBet, totalWon, biggestWin, freeSpinsPlayed, jackpots, peakBankroll } = stats
  if (!isFiniteNonNegative(spins) || !isFiniteNonNegative(statTotalBet) || !isFiniteNonNegative(totalWon)) return null
  if (!isFiniteNonNegative(biggestWin) || !isFiniteNonNegative(freeSpinsPlayed) || !isFiniteNonNegative(jackpots)) return null
  if (!isFiniteNonNegative(peakBankroll)) return null

  return {
    version: 1,
    bankroll,
    coinValue: coinValue as CoinValue,
    history: history.slice(0, SAVE_HISTORY_LENGTH),
    stats: { spins, totalBet: statTotalBet, totalWon, biggestWin, freeSpinsPlayed, jackpots, peakBankroll },
  }
}
