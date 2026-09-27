import { useState } from 'react'
import { PAYLINES } from '../game/paylines.ts'
import { PAYTABLE, SCATTER_FREE_SPINS, SCATTER_PAYS } from '../game/paytable.ts'
import { SYMBOL_ORDER } from '../game/reels.ts'
import { LINE_COUNT } from '../game/types.ts'
import { SYMBOL_COLOR } from '../render/symbolTextures.ts'
import type { SymbolId } from '../game/types.ts'
import type { CameraView, HudSnapshot } from '../render/engineApi.ts'

interface HudProps {
  /** Null until the engine's first snapshot arrives after `startSession()`. */
  hud: HudSnapshot | null
  cameraView: CameraView
  quickSpin: boolean
  muted: boolean
  onBetUp: () => void
  onBetDown: () => void
  onMaxBet: () => void
  onSpin: () => void
  /** 0 stops autoplay; any other count starts it running for that many spins. */
  onSetAutoplay: (count: number) => void
  onRefill: () => void
  onCycleCamera: () => void
  onToggleQuickSpin: () => void
  onToggleMute: () => void
  onOpenMenu: () => void
}

const CAMERA_LABEL: Record<CameraView, string> = { close: 'Close', wide: 'Wide', floor: 'Floor' }

/** The AUTO menu's spin-count choices. */
const AUTOPLAY_COUNTS = [10, 25, 50] as const

const SYMBOL_LABEL: Record<SymbolId, string> = {
  seven: 'Seven',
  bar: 'Bar',
  bell: 'Bell',
  diamond: 'Diamond',
  cherry: 'Cherry',
  lemon: 'Lemon',
  orange: 'Orange',
  plum: 'Plum',
  wild: 'Wild',
  scatter: 'Scatter',
}

/** Formats credits with thousands separators, e.g. `1,250`. */
export function formatCredits(amount: number): string {
  return Math.round(amount).toLocaleString('en-US')
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="13.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function QuickSpinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M5 5v14l9-7Z" fill="currentColor" />
      <path d="M13 5v14l9-7Z" fill="currentColor" opacity="0.6" />
    </svg>
  )
}

function MuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path d="m16 9 5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function UnmuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path
        d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** A 5x3 grid of dots with the line's cells joined by a stroke, for the paytable's payline key. */
function PaylineDots({ line }: { line: readonly number[] }) {
  const cellSize = 10
  const gap = 3
  const width = 5 * cellSize + 4 * gap
  const height = 3 * cellSize + 2 * gap
  const cx = (reel: number) => reel * (cellSize + gap) + cellSize / 2
  const cy = (row: number) => row * (cellSize + gap) + cellSize / 2
  const points = line.map((row, reel) => `${cx(reel)},${cy(row)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="payline-grid" aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--color-gold-bright)" strokeWidth="1.4" />
      {[0, 1, 2].map((row) =>
        [0, 1, 2, 3, 4].map((reel) => (
          <circle
            key={`${reel}-${row}`}
            cx={cx(reel)}
            cy={cy(row)}
            r={row === line[reel] ? 3.4 : 2}
            fill={row === line[reel] ? 'var(--color-gold-bright)' : 'rgba(245, 236, 217, 0.25)'}
          />
        )),
      )}
    </svg>
  )
}

/** The paying symbols in payout order (scatter and wild carry their own rules, shown separately). */
const PAYTABLE_SYMBOLS = SYMBOL_ORDER.filter((symbol): symbol is Exclude<SymbolId, 'wild' | 'scatter'> => symbol in PAYTABLE)

function PaytableModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="paytable-modal felt-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Paytable"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-section">
          <h2 className="panel-heading">Pays per line (in coins)</h2>
          <div className="paytable-grid">
            {PAYTABLE_SYMBOLS.map((symbol) => (
              <div className="paytable-row" key={symbol}>
                <span className="symbol-swatch" style={{ background: SYMBOL_COLOR[symbol] }} aria-hidden="true" />
                <span className="paytable-symbol-label">{SYMBOL_LABEL[symbol]}</span>
                <span className="paytable-values tabular">
                  {PAYTABLE[symbol][0]} · {PAYTABLE[symbol][1]} · {PAYTABLE[symbol][2]}
                </span>
              </div>
            ))}
            <div className="paytable-row">
              <span className="symbol-swatch" style={{ background: SYMBOL_COLOR.wild }} aria-hidden="true" />
              <span className="paytable-symbol-label">Wild</span>
              <span className="paytable-values">Substitutes for any symbol but scatter</span>
            </div>
            <div className="paytable-row">
              <span className="symbol-swatch" style={{ background: SYMBOL_COLOR.scatter }} aria-hidden="true" />
              <span className="paytable-symbol-label">Scatter</span>
              <span className="paytable-values tabular">
                {SCATTER_PAYS[0]}&times; · {SCATTER_PAYS[1]}&times; · {SCATTER_PAYS[2]}&times; total bet, anywhere
              </span>
            </div>
          </div>
          <p className="how-to-line">
            3, 4 or 5 scatters award {SCATTER_FREE_SPINS[0]}, {SCATTER_FREE_SPINS[1]} or {SCATTER_FREE_SPINS[2]} free
            spins; every free-spin win pays double and free spins can retrigger.
          </p>
        </div>

        <div className="panel-section">
          <h2 className="panel-heading">{LINE_COUNT} paylines</h2>
          <div className="paytable-lines">
            {PAYLINES.map((line, i) => (
              <div className="payline-entry" key={i}>
                <span className="payline-number">{i + 1}</span>
                <PaylineDots line={line} />
              </div>
            ))}
          </div>
        </div>

        <button type="button" className="secondary-button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

/**
 * The in-play chrome: credits/bet/win/free-spin pills, the history strip, a bet stepper, MAX BET,
 * an AUTO menu, the big SPIN button and a PAYS button that opens the paytable modal, plus the
 * broke overlay. Stays clear of the reel window and respects safe-area insets; `App` measures
 * this bar's own footprint with `ResizeObserver` to report `setViewInsets` back to the engine.
 */
export default function Hud({
  hud,
  cameraView,
  quickSpin,
  muted,
  onBetUp,
  onBetDown,
  onMaxBet,
  onSpin,
  onSetAutoplay,
  onRefill,
  onCycleCamera,
  onToggleQuickSpin,
  onToggleMute,
  onOpenMenu,
}: HudProps) {
  const [autoMenuOpen, setAutoMenuOpen] = useState(false)
  const [paysOpen, setPaysOpen] = useState(false)

  const spinning = hud?.phase === 'spinning'
  const inBonus = hud?.freeSpins !== null && hud?.freeSpins !== undefined
  const autoplayOn = (hud?.autoplayRemaining ?? 0) > 0
  const history = hud?.history.slice(0, 20) ?? []

  function handleChooseAutoplay(count: number) {
    setAutoMenuOpen(false)
    onSetAutoplay(count)
  }

  function handleSpinClick() {
    if (autoplayOn) {
      onSetAutoplay(0)
      return
    }
    onSpin()
  }

  return (
    <>
      <div className="hud-top-bar felt-panel">
        <div className="hud-pill-row">
          <div className="hud-pill">
            <span className="hud-pill-label">Credits</span>
            <span className="hud-pill-value">{formatCredits(hud?.bankroll ?? 0)}</span>
          </div>
          <div className="hud-pill">
            <span className="hud-pill-label">Bet</span>
            <span className="hud-pill-value">{formatCredits(hud?.totalBet ?? 0)}</span>
          </div>
          <div className="hud-pill">
            <span className="hud-pill-label">Win</span>
            <span className={`hud-pill-value${(hud?.lastWin ?? 0) > 0 ? ' hud-last-win' : ''}`}>
              {formatCredits(hud?.lastWin ?? 0)}
            </span>
          </div>
          {hud?.freeSpins && (
            <div className="hud-pill hud-free-spins">
              <span className="hud-pill-label">Free spins</span>
              <span className="hud-pill-value">
                {hud.freeSpins.remaining}/{hud.freeSpins.total} &times;{hud.freeSpins.multiplier}
              </span>
            </div>
          )}
        </div>

        <div className="hud-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={`Camera view: ${CAMERA_LABEL[cameraView]}. Change view`}
            onClick={onCycleCamera}
          >
            <CameraIcon />
            <span className="icon-button-caption">{CAMERA_LABEL[cameraView]}</span>
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Quick spin"
            aria-pressed={quickSpin}
            onClick={onToggleQuickSpin}
          >
            <QuickSpinIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={onToggleMute}
          >
            {muted ? <MuteIcon /> : <UnmuteIcon />}
          </button>
          <button type="button" className="icon-button" aria-label="Menu" onClick={onOpenMenu}>
            <MenuIcon />
          </button>
        </div>
      </div>

      {history.length > 0 && (
        <div className="hud-history-strip" aria-label="Recent spins">
          {history.map((win, i) => (
            <span
              key={i}
              className={`hud-history-disc ${win > 0 ? 'hud-win' : 'hud-nowin'}${i === 0 ? ' hud-history-disc-newest' : ''}`}
              title={win > 0 ? `Won ${formatCredits(win)}` : 'No win'}
            />
          ))}
        </div>
      )}

      <div className="hud-bottom-bar felt-panel">
        <div className="hud-bottom-row">
          <div className="bet-stepper">
            <button
              type="button"
              className="secondary-button"
              aria-label="Bet down"
              disabled={!hud?.canBetDown}
              onClick={onBetDown}
            >
              &minus;
            </button>
            <span className="bet-stepper-value">
              <span className="bet-stepper-coin tabular">{formatCredits(hud?.coinValue ?? 0)}</span>
              <span className="bet-stepper-caption">per line &middot; {formatCredits(hud?.totalBet ?? 0)} total</span>
            </span>
            <button
              type="button"
              className="secondary-button"
              aria-label="Bet up"
              disabled={!hud?.canBetUp}
              onClick={onBetUp}
            >
              +
            </button>
          </div>

          <div className="hud-action-buttons">
            <button type="button" className="secondary-button" disabled={!hud?.canBetUp} onClick={onMaxBet}>
              Max bet
            </button>

            <div className="auto-menu">
              <button
                type="button"
                className="secondary-button"
                aria-haspopup="true"
                aria-expanded={autoMenuOpen}
                onClick={() => setAutoMenuOpen((open) => !open)}
              >
                {autoplayOn ? `Auto ${hud?.autoplayRemaining}` : 'Auto'}
              </button>
              {autoMenuOpen && (
                <div className="auto-menu-list">
                  {AUTOPLAY_COUNTS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      className="secondary-button"
                      onClick={() => handleChooseAutoplay(count)}
                    >
                      {count}
                    </button>
                  ))}
                  <button type="button" className="secondary-button" onClick={() => handleChooseAutoplay(0)}>
                    Stop
                  </button>
                </div>
              )}
            </div>

            <button type="button" className="secondary-button" onClick={() => setPaysOpen(true)}>
              Pays
            </button>

            <button type="button" className="spin-button" disabled={!hud?.canSpin && !autoplayOn} onClick={handleSpinClick}>
              {autoplayOn ? `Stop ${hud?.autoplayRemaining}` : spinning ? 'Spinning' : inBonus ? 'Free spin' : 'Spin'}
            </button>
          </div>
        </div>
      </div>

      {paysOpen && <PaytableModal onClose={() => setPaysOpen(false)} />}

      {hud?.broke && (
        <div className="modal-backdrop">
          <div className="broke-card felt-panel" role="dialog" aria-modal="true" aria-label="Out of credits">
            <h2 className="broke-title">Out of credits</h2>
            <button type="button" className="primary-button" onClick={onRefill}>
              Refill 1,000 credits
            </button>
          </div>
        </div>
      )}
    </>
  )
}
