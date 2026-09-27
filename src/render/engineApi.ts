import type { CoinValue, LineWin, SessionPhase, SessionSave, SoundName, SymbolId, WinTier } from '../game/types.ts'

/** The last spin, as the HUD shows it. */
export interface HudResult {
  bet: number
  win: number
  tier: WinTier
  lineWins: LineWin[]
  scatterCount: number
  freeSpinsAwarded: number
}

export interface HudFreeSpins {
  remaining: number
  total: number
  won: number
  multiplier: number
}

/** What the HUD shows. A new object is sent only when one of its fields changes. */
export interface HudSnapshot {
  phase: SessionPhase
  /** Credits in the machine. */
  bankroll: number
  coinValue: CoinValue
  lines: number
  totalBet: number
  /** Credits won on the last spin, counted up by the engine while the win tallies. */
  lastWin: number
  /** Set while the result of the last spin is showing, and until the next spin. */
  lastResult: HudResult | null
  freeSpins: HudFreeSpins | null
  autoplayRemaining: number
  /** The symbols showing, `window[reel][row]`, once the reels have stopped; null while spinning. */
  window: SymbolId[][] | null
  /** Credits won on past spins, newest first, at most 20. */
  history: number[]
  canSpin: boolean
  canBetUp: boolean
  canBetDown: boolean
  /** No credits left: the HUD offers a refill. */
  broke: boolean
  spins: number
}

export type EngineSound = SoundName

/** Callbacks from the 3D engine to the React shell. All are invoked on the main thread. */
export interface EngineEvents {
  onHud(snapshot: HudSnapshot): void
  /** A one-shot sound. `intensity` runs 0 to 1 and scales the volume of wins and crowd sounds. */
  onSound(name: EngineSound, intensity: number): void
  /**
   * The reels' spinning whirr. `level` 0 is silent and 1 is all five reels at full speed; `pitch`
   * 0 to 1 follows their speed. Sent at most once a frame, and only when either value moves by
   * more than 0.02, or drops to 0.
   */
  onReels(level: number, pitch: number): void
  /** A line for the attendant's call-out banner, e.g. `Free spins!` or `Big win`. */
  onMessage(text: string, seconds: number): void
  /** Persist this. Sent when a spin settles, when the bet changes, and on refill. */
  onSave(save: SessionSave): void
}

/** 'play' takes the player's bets. 'attract' spins the machine by itself with demo credits and fires no events. */
export type EngineMode = 'play' | 'attract'

/**
 * 'close' frames the reel window with its bezel and the top of the deck, 'wide' stands back to
 * see the whole machine and its topper, and 'floor' looks along the row of machines. While the
 * attract mode runs behind the menu the camera picks 'close' or 'wide' by itself.
 */
export type CameraView = 'close' | 'wide' | 'floor'

/** Screen space covered by UI, in CSS pixels, measured in from each edge of the canvas. */
export interface ViewInsets {
  left: number
  top: number
  right: number
  bottom: number
}

export interface EngineApi {
  /** Starts play from a saved session, or a fresh 1,000-credit bankroll for `null`. */
  startSession(save: SessionSave | null): void
  /** Leaves 'play' mode (autoplay stops; a spin in flight finishes silently) and runs the attract mode. */
  showAttract(): void
  spin(): void
  setCoinValue(value: CoinValue): void
  betUp(): void
  betDown(): void
  /** Sets the largest coin value. */
  maxBet(): void
  /** Spins this many times by itself; 0 stops. */
  setAutoplay(count: number): void
  /** Resets a broke bankroll to 1,000 credits. */
  refill(): void
  setCameraView(view: CameraView): void
  /** Runs the reels at double speed. The outcome of a spin does not change. */
  setQuickSpin(on: boolean): void
  /** Keeps the machine clear of the part of the canvas the UI covers. */
  setViewInsets(insets: ViewInsets): void
  /** Freezes the reels and the clocks. The scene keeps rendering. */
  setPaused(paused: boolean): void
  /** Re-reads the canvas size. The engine also observes its canvas, so this is rarely needed. */
  resize(): void
  dispose(): void
}
