import { useState } from 'react'
import { PAYTABLE, SCATTER_FREE_SPINS, SCATTER_PAYS } from '../game/paytable.ts'
import { formatCredits } from './Hud.tsx'
import type { CameraView } from '../render/engineApi.ts'

interface MenuProps {
  /** A saved session exists (this run or a previous visit); shows "Continue" instead of "Play". */
  hasSave: boolean
  savedBankroll: number
  muted: boolean
  quickSpin: boolean
  cameraView: CameraView
  onPlay: () => void
  onToggleMute: () => void
  onToggleQuickSpin: () => void
  onCycleCamera: () => void
  onResetCredits: () => void
}

const CAMERA_LABEL: Record<CameraView, string> = { auto: 'Auto', reels: 'Reels', cabinet: 'Cabinet', floor: 'Floor' }

/** How to play, six short lines. */
const HOW_TO_LINES: string[] = [
  'Five reels, three rows, twenty paylines.',
  'Match three or more of a kind left to right on a line to win.',
  'The wild substitutes for any symbol but the scatter.',
  'Three or more scatters anywhere award free spins.',
  'Free spins pay double on every win, and can retrigger.',
  'Five sevens on a payline is the jackpot: 1000x the coin value.',
]

/** One row of the short paytable: the five-of-a-kind pay for the top symbols. */
const TOP_PAYS: { label: string; five: number }[] = [
  { label: 'Seven', five: PAYTABLE.seven[2] },
  { label: 'Bar', five: PAYTABLE.bar[2] },
  { label: 'Bell', five: PAYTABLE.bell[2] },
]

/** One row of the keyboard legend, matching the bindings in `App.tsx`. */
const KEYBOARD_LEGEND: { label: string; keys: string }[] = [
  { label: 'Spin', keys: 'Space / Enter' },
  { label: 'Bet up', keys: '↑ / + / =' },
  { label: 'Bet down', keys: '↓ / -' },
  { label: 'Max bet', keys: 'X' },
  { label: 'Coin value', keys: '1 – 5' },
  { label: 'Autoplay', keys: 'A' },
  { label: 'Camera', keys: 'C' },
  { label: 'Quick spin', keys: 'Q' },
  { label: 'Mute', keys: 'M' },
  { label: 'Menu', keys: 'Esc' },
]

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

/**
 * The art-deco title screen: a docked panel on wide screens (so attract mode stays visible on
 * the machine behind it) or a bottom sheet on phones. Play/Continue, an expandable how-to-play
 * with a short paytable and the scatter rule, a keyboard legend, settings toggles, a
 * reset-credits control with an inline confirm, and the no-real-money footer.
 */
export default function Menu({
  hasSave,
  savedBankroll,
  muted,
  quickSpin,
  cameraView,
  onPlay,
  onToggleMute,
  onToggleQuickSpin,
  onCycleCamera,
  onResetCredits,
}: MenuProps) {
  const [howToOpen, setHowToOpen] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)

  function handleResetClick() {
    if (confirmingReset) {
      setConfirmingReset(false)
      onResetCredits()
    } else {
      setConfirmingReset(true)
    }
  }

  return (
    <div className="menu-screen">
      <div className="menu-panel felt-panel">
        <div className="menu-top-row">
          <div className="bulb-border">
            <h1 className="menu-title">Slots Royale</h1>
          </div>
        </div>
        <p className="menu-tagline">Five reels. Twenty lines. Free spins pay double.</p>

        <button type="button" className="primary-button play-button" onClick={onPlay}>
          {hasSave ? `Continue — ${formatCredits(savedBankroll)} credits` : 'Play'}
        </button>

        <section className="panel-section">
          <button
            type="button"
            className="panel-heading panel-heading-toggle"
            aria-expanded={howToOpen}
            onClick={() => setHowToOpen((open) => !open)}
          >
            How to play {howToOpen ? '−' : '+'}
          </button>
          {howToOpen && (
            <div className="how-to-body">
              {HOW_TO_LINES.map((line) => (
                <p className="how-to-line" key={line}>
                  {line}
                </p>
              ))}
              <table className="payout-table">
                <tbody>
                  {TOP_PAYS.map((row) => (
                    <tr key={row.label}>
                      <td className="payout-label">{row.label} &times;5</td>
                      <td className="payout-value">{row.five} coins</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="payout-label">Scatter &times;3 / &times;4 / &times;5</td>
                    <td className="payout-value">
                      {SCATTER_PAYS[0]}/{SCATTER_PAYS[1]}/{SCATTER_PAYS[2]}&times; bet +{' '}
                      {SCATTER_FREE_SPINS[0]}/{SCATTER_FREE_SPINS[1]}/{SCATTER_FREE_SPINS[2]} spins
                    </td>
                  </tr>
                </tbody>
              </table>
              <dl className="legend-list pointer-only">
                {KEYBOARD_LEGEND.map((row) => (
                  <div className="legend-row" key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.keys}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>

        <section className="panel-section" aria-label="Settings">
          <h2 className="panel-heading">Settings</h2>
          <div className="settings-row">
            <span className="settings-label">Quick spin</span>
            <button
              type="button"
              className="toggle-switch"
              role="switch"
              aria-checked={quickSpin}
              aria-label="Quick spin"
              onClick={onToggleQuickSpin}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="settings-row">
            <span className="settings-label">Sound</span>
            <button
              type="button"
              className="icon-button"
              aria-label={muted ? 'Unmute' : 'Mute'}
              onClick={onToggleMute}
            >
              {muted ? <MuteIcon /> : <UnmuteIcon />}
            </button>
          </div>
          <div className="settings-row">
            <span className="settings-label">Camera</span>
            <button type="button" className="secondary-button settings-camera" onClick={onCycleCamera}>
              {CAMERA_LABEL[cameraView]}
            </button>
          </div>
        </section>

        <section className="panel-section">
          {confirmingReset ? (
            <div className="reset-confirm-row">
              <span className="settings-label">Reset to 1,000 credits?</span>
              <button type="button" className="secondary-button" onClick={handleResetClick}>
                Confirm
              </button>
              <button type="button" className="secondary-button" onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="secondary-button" onClick={handleResetClick}>
              Reset credits
            </button>
          )}
        </section>

        <p className="menu-footer">Credits only. No real money.</p>
      </div>
    </div>
  )
}
