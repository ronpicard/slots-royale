import { useEffect, useRef, useState } from 'react'
import { formatCredits } from './Hud.tsx'
import type { HudResult, HudSnapshot } from '../render/engineApi.ts'

interface ResultBannerProps {
  hud: HudSnapshot | null
  /** The attendant's call-out line, e.g. `Free spins!` or `Big win`, already timed by `App`. */
  message: string | null
}

const RESULT_VISIBLE_MS = 3500

/** The banner's headline and colour class for a settled result, or null to show nothing. */
function bannerFor(result: HudResult): { text: string; tierClass: string } | null {
  if (result.freeSpinsAwarded > 0) return { text: 'FREE SPINS', tierClass: 'free' }
  if (result.tier === 'jackpot') return { text: 'JACKPOT', tierClass: 'jackpot' }
  if (result.tier === 'mega') return { text: 'MEGA WIN', tierClass: 'mega' }
  if (result.tier === 'big') return { text: 'BIG WIN', tierClass: 'big' }
  return null
}

/**
 * Two transient lines above the reels: a small elegant call-out (`message`, from the engine's
 * `onMessage`) and, when a spin just settled with a big win or a free-spin award, a large banner
 * with the tier's name and the amount. The banner fades out on its own timer after about 3.5s;
 * the call-out's timing is owned by `App` (it already knows the duration from `onMessage`).
 * Nothing is shown for a small win or no win at all.
 */
export default function ResultBanner({ hud, message }: ResultBannerProps) {
  const [visible, setVisible] = useState(false)
  const prevSpinsRef = useRef<number | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!hud) return
    const prevSpins = prevSpinsRef.current
    prevSpinsRef.current = hud.spins
    if (prevSpins !== null && hud.spins !== prevSpins && hud.lastResult && bannerFor(hud.lastResult)) {
      setVisible(true)
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setVisible(false), RESULT_VISIBLE_MS)
    }
  }, [hud])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const banner = hud?.lastResult ? bannerFor(hud.lastResult) : null

  return (
    <>
      {message && (
        <div className="callout-banner" role="status" aria-live="polite">
          {message}
        </div>
      )}

      {banner && (
        <div
          className={`result-banner win-tier-${banner.tierClass}${visible ? ' result-banner-visible' : ''}`}
          aria-hidden={!visible}
        >
          <span className="result-tier-label">{banner.text}</span>
          <span className="result-win-line">+{formatCredits(hud?.lastResult?.win ?? 0)}</span>
        </div>
      )}
    </>
  )
}
