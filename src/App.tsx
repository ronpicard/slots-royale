import { useEffect, useRef, useState } from 'react'
import { createAudio } from './audio.ts'
import type { GameAudio } from './audio.ts'
import type { CoinValue } from './game/types.ts'
import type { CameraView, EngineApi, EngineEvents, HudSnapshot, ViewInsets } from './render/engineApi.ts'
import GameCanvas from './ui/GameCanvas.tsx'
import Hud from './ui/Hud.tsx'
import Menu from './ui/Menu.tsx'
import ResultBanner from './ui/ResultBanner.tsx'
import {
  clearSession,
  loadCamera,
  loadMuted,
  loadQuickSpin,
  loadSession,
  safeLocalStorage,
  saveCamera,
  saveMuted,
  saveQuickSpin,
  saveSession,
} from './ui/storage.ts'

/** The two screens the shell can show. The engine itself always keeps rendering behind them. */
type Mode = 'menu' | 'play'

/** A menu panel narrower than this share of the window is docked to the side, not a bottom sheet. */
const DOCKED_PANEL_MAX_FRACTION = 0.7

/** Pressing the camera button (or the `C` key) steps through these views in order, then wraps. */
const CAMERA_CYCLE: CameraView[] = ['close', 'wide', 'floor']

/** `A` (or the HUD's AUTO menu) toggles this many autoplay spins on and off. */
const AUTOPLAY_TOGGLE_COUNT = 25

/** Keys `1`-`5` jump straight to a coin value, in the same order as `COIN_VALUES`. */
const COIN_VALUE_KEYS: Record<string, CoinValue> = { '1': 1, '2': 2, '3': 5, '4': 10, '5': 25 }

/**
 * Top-level app shell. Owns the engine handle, the HUD snapshot, the attendant's call-out text,
 * `muted`/`quickSpin`/`cameraView` settings (persisted to `localStorage`), the menu/play mode,
 * and `paused`. The canvas is mounted once, full-screen, behind every screen; `Menu` and `Hud`
 * are just overlays on top of it.
 *
 * The engine's own pointer handling (the SPIN button, the lever, BET/MAX BET/AUTO) listens on the
 * canvas directly, so this component only owns the keys documented in the spec's App.tsx section
 * and the buttons in `Hud`/`Menu`.
 */
export default function App() {
  const [storage] = useState(() => safeLocalStorage())
  const [audio] = useState<GameAudio>(() => createAudio())
  const [muted, setMuted] = useState<boolean>(() => loadMuted(storage))
  const [quickSpin, setQuickSpin] = useState<boolean>(() => loadQuickSpin(storage))
  const [cameraView, setCameraView] = useState<CameraView>(() => loadCamera(storage))

  const [mode, setMode] = useState<Mode>('menu')
  const [paused, setPaused] = useState(false)
  const [api, setApi] = useState<EngineApi | null>(null)
  const [hud, setHud] = useState<HudSnapshot | null>(null)
  const [message, setMessage] = useState<{ id: number; text: string } | null>(null)
  const [savedSession, setSavedSession] = useState(() => loadSession(storage))

  const messageTimerRef = useRef<number | undefined>(undefined)
  const messageIdRef = useRef(0)
  const unlockedAudioRef = useRef(false)
  // Read inside the mode-change effect without making every autosave re-trigger it.
  const savedSessionRef = useRef(savedSession)
  savedSessionRef.current = savedSession
  // Read inside the keyboard effect (the `A` autoplay toggle) without re-binding it on every snapshot.
  const hudRef = useRef(hud)
  hudRef.current = hud

  useEffect(() => () => window.clearTimeout(messageTimerRef.current), [])
  useEffect(() => () => audio.dispose(), [audio])

  // Put the engine in the right mode whenever it changes: attract behind the menu, the saved (or
  // fresh) session when play starts. Going to the menu, per `EngineApi.showAttract`'s contract,
  // leaves any session-in-progress alone in memory (it was already autosaved), so play resumes
  // from the same bankroll.
  useEffect(() => {
    if (!api) return
    if (mode === 'menu') {
      api.showAttract()
    } else {
      api.startSession(savedSessionRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, api])

  // Apply the persisted settings once the engine is ready; later changes go straight through the
  // toggle handlers below instead of round-tripping through an effect.
  useEffect(() => {
    if (!api) return
    api.setCameraView(cameraView)
    api.setQuickSpin(quickSpin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  // Keep the machine clear of whichever panel currently covers the canvas: the docked/sheet menu
  // panel, or the HUD's top and bottom bars during play. A ResizeObserver catches content
  // changes (e.g. the paytable modal opening) as well as viewport resizes.
  useEffect(() => {
    if (!api) return
    function currentInsets(): ViewInsets {
      const insets: ViewInsets = { left: 0, top: 0, right: 0, bottom: 0 }
      const panel = document.querySelector<HTMLElement>('.menu-panel')
      const topBar = document.querySelector<HTMLElement>('.hud-top-bar')
      const bottomBar = document.querySelector<HTMLElement>('.hud-bottom-bar')
      if (panel) {
        const docked = panel.offsetWidth < window.innerWidth * DOCKED_PANEL_MAX_FRACTION
        if (docked) insets.left = panel.offsetWidth
        else insets.bottom = panel.offsetHeight
      }
      if (topBar) insets.top = topBar.offsetTop + topBar.offsetHeight
      if (bottomBar) {
        // On a short landscape phone the bottom bar becomes a full-height panel on the right.
        const rect = bottomBar.getBoundingClientRect()
        const sidePanel = rect.height > window.innerHeight / 2 && rect.width < window.innerWidth / 2
        if (sidePanel) insets.right = window.innerWidth - rect.left
        else insets.bottom = Math.max(insets.bottom, window.innerHeight - rect.top)
      }
      return insets
    }
    function update() {
      api?.setViewInsets(currentInsets())
    }
    update()
    const observer = new ResizeObserver(update)
    const watched = ['.menu-panel', '.hud-top-bar', '.hud-bottom-bar']
      .map((selector) => document.querySelector<HTMLElement>(selector))
      .filter((el): el is HTMLElement => el !== null)
    watched.forEach((el) => observer.observe(el))
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
    // Bars/panel exist in the DOM as soon as `mode` settles; re-running per `hud` snapshot would
    // tear down and rebuild the observer on every hover change.
  }, [api, mode])

  // Unlock audio on the very first user gesture, as browsers require.
  useEffect(() => {
    function unlock() {
      if (unlockedAudioRef.current) return
      unlockedAudioRef.current = true
      audio.resume()
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [audio])

  // Freeze the physics when the tab is hidden; the engine keeps rendering the last frame.
  useEffect(() => {
    function onVisibility() {
      const next = document.hidden
      setPaused(next)
      api?.setPaused(next)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [api])

  function handlePlay() {
    setMode('play')
  }

  function handleOpenMenu() {
    setMode('menu')
  }

  function handleCycleCamera() {
    setCameraView((current) => {
      const next = CAMERA_CYCLE[(CAMERA_CYCLE.indexOf(current) + 1) % CAMERA_CYCLE.length]!
      api?.setCameraView(next)
      saveCamera(storage, next)
      return next
    })
  }

  function handleToggleQuickSpin() {
    setQuickSpin((current) => {
      const next = !current
      api?.setQuickSpin(next)
      saveQuickSpin(storage, next)
      return next
    })
  }

  function handleToggleMute() {
    setMuted((current) => {
      const next = !current
      audio.setMuted(next)
      saveMuted(storage, next)
      return next
    })
  }

  function handleResetCredits() {
    clearSession(storage)
    savedSessionRef.current = null
    setSavedSession(null)
    if (mode === 'play') api?.startSession(null)
  }

  /** `A`, or the HUD's SPIN button while autoplay runs, toggles autoplay on (25 spins) and off. */
  function handleToggleAutoplay() {
    const running = (hudRef.current?.autoplayRemaining ?? 0) > 0
    api?.setAutoplay(running ? 0 : AUTOPLAY_TOGGLE_COUNT)
  }

  // Menu: Enter/Space starts play. Play: the keys documented in the spec's App.tsx section. Every
  // other key (and all pointer input on the machine itself) belongs to the engine.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target
      if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (paused) return
      if (mode === 'menu') {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault()
          handlePlay()
        }
        return
      }
      if (e.repeat) return
      const coinValue = COIN_VALUE_KEYS[e.key]
      if (coinValue !== undefined) {
        api?.setCoinValue(coinValue)
        return
      }
      switch (e.key) {
        case ' ':
        case 'Enter':
          e.preventDefault()
          api?.spin()
          break
        case 'ArrowUp':
        case '+':
        case '=':
          api?.betUp()
          break
        case 'ArrowDown':
        case '-':
          api?.betDown()
          break
        case 'x':
        case 'X':
          api?.maxBet()
          break
        case 'a':
        case 'A':
          handleToggleAutoplay()
          break
        case 'c':
        case 'C':
          handleCycleCamera()
          break
        case 'q':
        case 'Q':
          handleToggleQuickSpin()
          break
        case 'm':
        case 'M':
          handleToggleMute()
          break
        case 'Escape':
          handleOpenMenu()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, api, paused])

  const events: EngineEvents = {
    onHud: (snapshot) => setHud(snapshot),
    onSound: (name, intensity) => audio.play(name, intensity),
    onReels: (level, pitch) => audio.setReels(level, pitch),
    onMessage: (text, seconds) => {
      messageIdRef.current += 1
      const id = messageIdRef.current
      setMessage({ id, text })
      window.clearTimeout(messageTimerRef.current)
      messageTimerRef.current = window.setTimeout(() => {
        setMessage((current) => (current && current.id === id ? null : current))
      }, seconds * 1000)
    },
    onSave: (save) => {
      saveSession(storage, save)
      savedSessionRef.current = save
      setSavedSession(save)
    },
  }

  return (
    <div className="app-root">
      <GameCanvas events={events} onReady={setApi} />

      <div className="overlay-layer">
        {mode === 'menu' && (
          <Menu
            hasSave={savedSession !== null}
            savedBankroll={savedSession?.bankroll ?? 0}
            muted={muted}
            quickSpin={quickSpin}
            cameraView={cameraView}
            onPlay={handlePlay}
            onToggleMute={handleToggleMute}
            onToggleQuickSpin={handleToggleQuickSpin}
            onCycleCamera={handleCycleCamera}
            onResetCredits={handleResetCredits}
          />
        )}

        {mode === 'play' && (
          <>
            <Hud
              hud={hud}
              cameraView={cameraView}
              quickSpin={quickSpin}
              muted={muted}
              onBetUp={() => api?.betUp()}
              onBetDown={() => api?.betDown()}
              onMaxBet={() => api?.maxBet()}
              onSpin={() => api?.spin()}
              onSetAutoplay={(count) => api?.setAutoplay(count)}
              onRefill={() => api?.refill()}
              onCycleCamera={handleCycleCamera}
              onToggleQuickSpin={handleToggleQuickSpin}
              onToggleMute={handleToggleMute}
              onOpenMenu={handleOpenMenu}
            />
            <ResultBanner hud={hud} message={message?.text ?? null} />
          </>
        )}
      </div>
    </div>
  )
}
