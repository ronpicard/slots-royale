/**
 * Builds the three.js scene, camera, renderer and simulation loop for one canvas: the whole
 * slot machine on a casino floor. Everything created here (geometries, materials, textures,
 * render targets, the renderer, the composer, the DOM listeners) is disposed by `dispose()`, and
 * nothing is created outside this function, so the returned `EngineApi` is safe to construct and
 * tear down repeatedly (React StrictMode double-invokes it).
 */

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

import type { CameraView, EngineApi, EngineEvents, EngineMode, HudResult, HudSnapshot, ViewInsets } from './engineApi.ts'

import { createCasinoRoom } from './casinoRoom.ts'
import { createMachineView } from './machineView.ts'
import type { PaylineGlow } from './machineView.ts'
import { createReelView } from './reelView.ts'
import { createCrowd } from './crowd.ts'
import { createConfetti } from './confetti.ts'
import { SYMBOL_COLOR } from './symbolTextures.ts'
import {
  CABINET_MAX_X,
  CABINET_MAX_Z,
  CABINET_MIN_X,
  CABINET_MIN_Z,
  REEL_WINDOW_HEIGHT,
  REEL_WINDOW_WIDTH,
  REEL_WINDOW_Y,
  REEL_WINDOW_Z,
  TOPPER_HEIGHT,
  TOPPER_Y,
} from './layout.ts'

import type { CoinValue, SessionSave, SpinOutcome, SymbolId } from '../game/types.ts'
import {
  COIN_VALUES,
  betDown as betDownSession,
  betUp as betUpSession,
  createSession,
  isBroke,
  maxBet as maxBetSession,
  refill as refillSession,
  setAutoplay as setAutoplaySession,
  setCoinValue as setCoinValueSession,
  settle as settleSession,
  shouldAutoSpin,
  spin as spinSession,
  toSave,
  totalBet,
} from '../game/session.ts'
import { attractCoinValue } from '../game/autoplay.ts'
import { crowdReaction } from '../game/crowd.ts'
import { createRng, randomSeed } from '../game/rng.ts'

// -------------------------------------------------------------------------------------------
// Renderer / post-processing look
// -------------------------------------------------------------------------------------------

const BACKGROUND_COLOR = 0x0b0706
const FOG_DENSITY = 0.0018
const TONE_MAPPING_EXPOSURE = 1.1
const ENVIRONMENT_INTENSITY = 0.5
const BLOOM_STRENGTH = 0.35
const BLOOM_RADIUS = 0.5
const BLOOM_THRESHOLD = 0.9
const SHADOW_MAP_SIZE = 2048

const CAMERA_NEAR = 0.4
const CAMERA_FAR = 800
const CAMERA_FOV_DEGREES = 40

/**
 * Rendering cost steps, best first. The engine starts at the first step a device can likely hold
 * and only ever steps down, when frames stay slow, so a phone never flip-flops between two looks.
 */
const QUALITY_STEPS: { pixelRatio: number; bloom: boolean; shadowMapSize: number }[] = [
  { pixelRatio: 2, bloom: true, shadowMapSize: 2048 },
  { pixelRatio: 1.5, bloom: true, shadowMapSize: 1024 },
  { pixelRatio: 1, bloom: true, shadowMapSize: 1024 },
  { pixelRatio: 1, bloom: false, shadowMapSize: 1024 },
]
const TOUCH_START_QUALITY = 1
const SLOW_FRAME_SECONDS = 1 / 38
const SLOW_FRAMES_TO_STEP_DOWN = 90
const QUALITY_SETTLE_FRAMES = 60

// -------------------------------------------------------------------------------------------
// Loop / choreography timing
// -------------------------------------------------------------------------------------------

const MAX_FRAME_SECONDS = 1 / 20
const BASE_STOP_SECONDS: readonly number[] = [1.6, 1.9, 2.2, 2.5, 2.8]
const ANTICIPATION_EXTENSION_SECONDS = 0.9
const LEVER_PULL_SECONDS = 0.6
const GLOW_CYCLE_SECONDS = 0.7
const AUTO_CONTINUE_SECONDS = 0.8
const AUTO_CONTINUE_AFTER_WIN_SECONDS = 1.2
const ATTRACT_ROUND_GAP_SECONDS = 2.5
const HUD_THROTTLE_SECONDS = 1 / 20
const TAP_MAX_MOVE_PX = 8
const VIEW_SMOOTH_TIME = 0.9
const CAMERA_FIT_MARGIN = 0.04
const MIN_FREE_FRACTION = 0.3
const FIT_ITERATIONS = 24
const FIT_MIN_EXTRA = 0
const FIT_MAX_EXTRA = 500
const CABINET_FIT_MARGIN = 6

// -------------------------------------------------------------------------------------------
// Small maths helpers
// -------------------------------------------------------------------------------------------

/**
 * One axis of a critically-damped spring toward `target`, in the spirit of Unity's
 * `Mathf.SmoothDamp`: reaches the target smoothly in about `smoothTime` seconds with no overshoot.
 */
function smoothDamp(current: number, target: number, velocity: { v: number }, smoothTime: number, dt: number): number {
  const omega = 2 / Math.max(1e-4, smoothTime)
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = current - target
  const temp = (velocity.v + omega * change) * dt
  velocity.v = (velocity.v - omega * temp) * exp
  let output = target + (change + temp) * exp
  if (target - current > 0 === output > target) {
    output = target
    velocity.v = (output - target) / Math.max(1e-4, dt)
  }
  return output
}

function dampVector3(
  current: THREE.Vector3,
  target: THREE.Vector3,
  velocity: { x: { v: number }; y: { v: number }; z: { v: number } },
  smoothTime: number,
  dt: number,
): void {
  current.x = smoothDamp(current.x, target.x, velocity.x, smoothTime, dt)
  current.y = smoothDamp(current.y, target.y, velocity.y, smoothTime, dt)
  current.z = smoothDamp(current.z, target.z, velocity.z, smoothTime, dt)
}

function countSymbolInReels(window: SymbolId[][], reels: readonly number[], symbol: SymbolId): number {
  let count = 0
  for (const reel of reels) {
    for (const cell of window[reel] ?? []) if (cell === symbol) count++
  }
  return count
}

// -------------------------------------------------------------------------------------------
// Camera rig: three fixed lines of sight, each pulled back just far enough to keep its fit
// points inside the canvas minus the HUD insets (a bounding-sphere-style fit via binary search
// on the pull-back distance, as roulette-royale's Engine does for its own views).
// -------------------------------------------------------------------------------------------

type FitView = 'reels' | 'cabinet' | 'floor'

const CABINET_CENTER_Z = (CABINET_MIN_Z + CABINET_MAX_Z) / 2

const REELS_EYE = new THREE.Vector3(0, REEL_WINDOW_Y + 4, CABINET_MAX_Z + 26)
const REELS_LOOK = new THREE.Vector3(0, REEL_WINDOW_Y, REEL_WINDOW_Z)
const CABINET_EYE = new THREE.Vector3(6, 52, CABINET_MAX_Z + 62)
const CABINET_LOOK = new THREE.Vector3(0, 40, 0)
const FLOOR_EYE = new THREE.Vector3(-50, 56, CABINET_MAX_Z + 40)
const FLOOR_LOOK = new THREE.Vector3(0, 40, 0)

const REELS_FIT_POINTS: readonly THREE.Vector3[] = [
  new THREE.Vector3(-REEL_WINDOW_WIDTH / 2, REEL_WINDOW_Y - REEL_WINDOW_HEIGHT / 2, REEL_WINDOW_Z),
  new THREE.Vector3(REEL_WINDOW_WIDTH / 2, REEL_WINDOW_Y - REEL_WINDOW_HEIGHT / 2, REEL_WINDOW_Z),
  new THREE.Vector3(-REEL_WINDOW_WIDTH / 2, REEL_WINDOW_Y + REEL_WINDOW_HEIGHT / 2, REEL_WINDOW_Z),
  new THREE.Vector3(REEL_WINDOW_WIDTH / 2, REEL_WINDOW_Y + REEL_WINDOW_HEIGHT / 2, REEL_WINDOW_Z),
]
const CABINET_FIT_POINTS: readonly THREE.Vector3[] = [
  new THREE.Vector3(CABINET_MIN_X - CABINET_FIT_MARGIN, 0, CABINET_CENTER_Z),
  new THREE.Vector3(CABINET_MAX_X + CABINET_FIT_MARGIN, 0, CABINET_CENTER_Z),
  new THREE.Vector3(CABINET_MIN_X - CABINET_FIT_MARGIN, TOPPER_Y + TOPPER_HEIGHT / 2 + CABINET_FIT_MARGIN, CABINET_CENTER_Z),
  new THREE.Vector3(CABINET_MAX_X + CABINET_FIT_MARGIN, TOPPER_Y + TOPPER_HEIGHT / 2 + CABINET_FIT_MARGIN, CABINET_CENTER_Z),
]

function rigFor(view: FitView): { eye: THREE.Vector3; look: THREE.Vector3 } {
  if (view === 'reels') return { eye: REELS_EYE, look: REELS_LOOK }
  if (view === 'cabinet') return { eye: CABINET_EYE, look: CABINET_LOOK }
  return { eye: FLOOR_EYE, look: FLOOR_LOOK }
}

function fitPointsFor(view: FitView): readonly THREE.Vector3[] {
  if (view === 'reels') return REELS_FIT_POINTS
  return CABINET_FIT_POINTS
}

// -------------------------------------------------------------------------------------------
// Engine
// -------------------------------------------------------------------------------------------

export function createEngine(canvas: HTMLCanvasElement, events: EngineEvents): EngineApi {
  // --- Renderer / scene ----------------------------------------------------------------------

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  const requestedQuality = new URLSearchParams(window.location.search).get('quality')
  const qualityPinned = requestedQuality === 'high' || requestedQuality === 'low'
  const touchDevice = window.matchMedia('(pointer: coarse)').matches
  let qualityStep =
    requestedQuality === 'high' ? 0
    : requestedQuality === 'low' ? QUALITY_STEPS.length - 1
    : touchDevice ? TOUCH_START_QUALITY
    : 0
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY_STEPS[qualityStep]!.pixelRatio))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BACKGROUND_COLOR)
  scene.fog = new THREE.FogExp2(BACKGROUND_COLOR, FOG_DENSITY)

  // --- Environment: the room's own glow lights the lacquer and chrome ------------------------

  const room = createCasinoRoom()
  const pmremGenerator = new THREE.PMREMGenerator(renderer)
  const environmentScene = new THREE.Scene()
  environmentScene.background = new THREE.Color(BACKGROUND_COLOR)
  const softboxGeometry = new THREE.PlaneGeometry(90, 60)
  const softboxMaterial = new THREE.MeshBasicMaterial({ color: 0xffe9cf, side: THREE.DoubleSide })
  softboxMaterial.color.multiplyScalar(2.2)
  const softbox = new THREE.Mesh(softboxGeometry, softboxMaterial)
  softbox.rotation.x = Math.PI / 2
  softbox.position.set(0, TOPPER_Y + 60, CABINET_MAX_Z - 10)
  const environmentFill = new THREE.HemisphereLight(0x8a7550, 0x140a06, 0.5)
  environmentScene.add(room.group, softbox, environmentFill)
  const environmentTarget = pmremGenerator.fromScene(environmentScene, 0.015, 1, 900, {
    position: new THREE.Vector3(0, REEL_WINDOW_Y, CABINET_MAX_Z - 20),
  })
  scene.environment = environmentTarget.texture
  scene.environmentIntensity = ENVIRONMENT_INTENSITY
  environmentScene.remove(room.group, softbox, environmentFill)
  softboxGeometry.dispose()
  softboxMaterial.dispose()
  environmentFill.dispose()
  pmremGenerator.dispose()
  scene.add(room.group)

  // --- Post-processing -------------------------------------------------------------------------

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEGREES, 1, CAMERA_NEAR, CAMERA_FAR)

  const composer = new EffectComposer(renderer)
  const renderPass = new RenderPass(scene, camera)
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD)
  const outputPass = new OutputPass()
  bloomPass.enabled = QUALITY_STEPS[qualityStep]!.bloom
  composer.addPass(renderPass)
  composer.addPass(bloomPass)
  composer.addPass(outputPass)

  // --- Scene content -----------------------------------------------------------------------------

  const machine = createMachineView()
  const reels = createReelView()
  const crowd = createCrowd()
  const confetti = createConfetti()
  scene.add(machine.group, reels.group, crowd.group, confetti.group)

  // --- Lighting (point/spot lights decay = 0: the scene is inches, not metres) -------------------

  const reelSpot = new THREE.SpotLight(0xffdca8, 3.2)
  reelSpot.position.set(0, 105, CABINET_MAX_Z + 30)
  reelSpot.target.position.set(0, REEL_WINDOW_Y, REEL_WINDOW_Z)
  reelSpot.angle = Math.atan2(Math.max(REEL_WINDOW_WIDTH, REEL_WINDOW_HEIGHT) * 1.4, 105 - REEL_WINDOW_Y)
  reelSpot.penumbra = 0.5
  reelSpot.decay = 0
  reelSpot.distance = 0
  reelSpot.castShadow = true
  reelSpot.shadow.mapSize.setScalar(Math.min(SHADOW_MAP_SIZE, QUALITY_STEPS[qualityStep]!.shadowMapSize))
  reelSpot.shadow.camera.near = 10
  reelSpot.shadow.camera.far = 220
  reelSpot.shadow.bias = -0.0006
  reelSpot.shadow.normalBias = 0.02
  scene.add(reelSpot, reelSpot.target)

  const topperLight = new THREE.PointLight(0xffcf8a, 0.6, 0, 0)
  topperLight.position.set(0, TOPPER_Y, CABINET_CENTER_Z)
  topperLight.castShadow = false
  scene.add(topperLight)

  const coolFill = new THREE.DirectionalLight(0x9fc9ff, 0.35)
  coolFill.position.set(CABINET_MIN_X - 60, 70, CABINET_MAX_Z - 10)
  scene.add(coolFill)

  const hemiFill = new THREE.HemisphereLight(0x8a7550, 0x140a06, 0.35)
  scene.add(hemiFill)

  const rimLight = new THREE.DirectionalLight(0xfff2d6, 0.3)
  rimLight.position.set(0, 90, CABINET_MIN_Z - 50)
  scene.add(rimLight)

  // --- Camera rig state --------------------------------------------------------------------------

  const probeCamera = new THREE.PerspectiveCamera(CAMERA_FOV_DEGREES, 1, CAMERA_NEAR, CAMERA_FAR)
  const projectedScratch = new THREE.Vector3()
  const eyeScratch = new THREE.Vector3()

  const fitExtra: Record<FitView, number> = { reels: 0, cabinet: 0, floor: 0 }
  let insets: ViewInsets = { left: 0, top: 0, right: 0, bottom: 0 }
  let aspect = 1

  const cameraPosition = new THREE.Vector3()
  const cameraLookAt = new THREE.Vector3()
  const cameraPositionVelocity = { x: { v: 0 }, y: { v: 0 }, z: { v: 0 } }
  const cameraLookAtVelocity = { x: { v: 0 }, y: { v: 0 }, z: { v: 0 } }
  let cameraInitialized = false

  function pullBack(eye: THREE.Vector3, look: THREE.Vector3, extra: number, out: THREE.Vector3): void {
    if (extra <= 0) {
      out.copy(eye)
      return
    }
    const dx = eye.x - look.x
    const dy = eye.y - look.y
    const dz = eye.z - look.z
    const length = Math.hypot(dx, dy, dz)
    if (length < 1e-6) {
      out.copy(eye)
      return
    }
    const scale = (length + extra) / length
    out.set(look.x + dx * scale, look.y + dy * scale, look.z + dz * scale)
  }

  function cornersFit(points: readonly THREE.Vector3[], limitX: number, limitY: number): boolean {
    probeCamera.updateMatrixWorld(true)
    probeCamera.updateProjectionMatrix()
    return points.every((corner) => {
      projectedScratch.copy(corner).project(probeCamera)
      return Math.abs(projectedScratch.x) <= limitX && Math.abs(projectedScratch.y) <= limitY
    })
  }

  function fitView(view: FitView): number {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return fitExtra[view]

    const freeX = Math.max(MIN_FREE_FRACTION, (width - insets.left - insets.right) / width)
    const freeY = Math.max(MIN_FREE_FRACTION, (height - insets.top - insets.bottom) / height)
    const limitX = freeX * (1 - CAMERA_FIT_MARGIN)
    const limitY = freeY * (1 - CAMERA_FIT_MARGIN)
    const { eye, look } = rigFor(view)
    const points = fitPointsFor(view)

    probeCamera.fov = CAMERA_FOV_DEGREES
    probeCamera.aspect = aspect
    probeCamera.near = CAMERA_NEAR
    probeCamera.far = CAMERA_FAR

    function fits(extra: number): boolean {
      pullBack(eye, look, extra, eyeScratch)
      probeCamera.position.copy(eyeScratch)
      probeCamera.up.set(0, 1, 0)
      probeCamera.lookAt(look)
      return cornersFit(points, limitX, limitY)
    }

    let lo = FIT_MIN_EXTRA
    let hi = FIT_MAX_EXTRA
    if (!fits(hi)) return hi
    for (let i = 0; i < FIT_ITERATIONS; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) hi = mid
      else lo = mid
    }
    return hi
  }

  function refitAllViews(): void {
    fitExtra.reels = fitView('reels')
    fitExtra.cabinet = fitView('cabinet')
    fitExtra.floor = fitView('floor')
  }

  function applyViewOffset(): void {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    camera.setViewOffset(width, height, -(insets.left - insets.right) / 2, -(insets.top - insets.bottom) / 2, width, height)
  }

  function resolveView(): FitView {
    if (cameraView !== 'auto') return cameraView
    // Portrait screens cannot read the reels from the cabinet view, so stay close while playing.
    if (aspect < 1 && mode === 'play') return 'reels'
    if (session.phase === 'spinning') return 'reels'
    if (session.phase === 'result') {
      const tier = session.lastOutcome?.tier
      const bigPlus = tier === 'big' || tier === 'mega' || tier === 'jackpot'
      if (bigPlus) return 'cabinet'
      return resultElapsed < 1.2 ? 'reels' : 'cabinet'
    }
    return 'cabinet'
  }

  function updateCamera(dt: number): void {
    const resolved = resolveView()
    const { eye, look } = rigFor(resolved)
    pullBack(eye, look, fitExtra[resolved], eyeScratch)

    if (!cameraInitialized) {
      cameraPosition.copy(eyeScratch)
      cameraLookAt.copy(look)
      cameraInitialized = true
    } else {
      dampVector3(cameraPosition, eyeScratch, cameraPositionVelocity, VIEW_SMOOTH_TIME, dt)
      dampVector3(cameraLookAt, look, cameraLookAtVelocity, VIEW_SMOOTH_TIME, dt)
    }
    camera.position.copy(cameraPosition)
    camera.up.set(0, 1, 0)
    camera.lookAt(cameraLookAt)
  }

  // --- Session / choreography state ---------------------------------------------------------------

  let mode: EngineMode = 'attract'
  let session = createSession(null)
  let quickSpin = false
  let paused = false
  let cameraView: CameraView = 'auto'

  let resultElapsed = 0
  let simTime = 0
  let displayedWin = 0

  let spinStopTimes: number[] | null = null
  let spinElapsed = 0
  let nextReelStopIndex = 0
  let wasSpinning = false

  interface Presentation {
    elapsed: number
    glows: PaylineGlow[]
    glowIndex: number
    glowStep: number
    countUpDuration: number
    duration: number
    totalWin: number
  }
  let presentation: Presentation | null = null

  let pendingAction: { remaining: number; fn: () => void } | null = null
  let pendingModeSwitch: (() => void) | null = null

  let lastLevel = 0
  let lastPitch = 0
  let lastHud: HudSnapshot | null = null
  let hudThrottle = 0

  const scratchColor = new THREE.Color()
  function colorNumberFor(symbol: SymbolId): number {
    scratchColor.set(SYMBOL_COLOR[symbol])
    return scratchColor.getHex()
  }

  function qsScale(): number {
    return quickSpin ? 0.5 : 1
  }

  // --- Command execution -----------------------------------------------------------------------

  function applyTransition(t: { session: typeof session; commands: readonly { type: string; name?: string; text?: string; seconds?: number }[] }, silent: boolean): void {
    session = t.session
    for (const command of t.commands) {
      switch (command.type) {
        case 'sound':
          if (!silent && command.name) events.onSound(command.name as Parameters<EngineEvents['onSound']>[0], 1)
          break
        case 'message':
          if (!silent && command.text !== undefined && command.seconds !== undefined) events.onMessage(command.text, command.seconds)
          break
        case 'save':
          if (!silent) events.onSave(toSave(session))
          break
        default:
          break
      }
    }
  }

  function canSpinNow(): boolean {
    return mode === 'play' && session.phase !== 'spinning' && (session.freeSpins !== null || session.bankroll >= totalBet(session))
  }

  // --- HUD ---------------------------------------------------------------------------------------

  function buildHud(): HudSnapshot {
    const outcome = session.lastOutcome
    const lastResult: HudResult | null =
      session.phase === 'result' && outcome
        ? {
            bet: outcome.bet,
            win: outcome.totalWin,
            tier: outcome.tier,
            lineWins: outcome.lineWins,
            scatterCount: outcome.scatter?.count ?? 0,
            freeSpinsAwarded: outcome.scatter?.freeSpins ?? 0,
          }
        : null
    return {
      phase: session.phase,
      bankroll: session.bankroll,
      coinValue: session.coinValue,
      lines: 20,
      totalBet: totalBet(session),
      lastWin: displayedWin,
      lastResult,
      freeSpins: session.freeSpins
        ? {
            remaining: session.freeSpins.remaining,
            total: session.freeSpins.total,
            won: session.freeSpins.won,
            multiplier: session.freeSpins.multiplier,
          }
        : null,
      autoplayRemaining: session.autoplayRemaining,
      window: session.phase !== 'spinning' ? (outcome?.window ?? null) : null,
      history: session.history.slice(0, 20),
      canSpin: canSpinNow(),
      canBetUp: mode === 'play' && session.phase !== 'spinning' && session.freeSpins === null,
      canBetDown: mode === 'play' && session.phase !== 'spinning' && session.freeSpins === null,
      broke: isBroke(session),
      spins: session.stats.spins,
    }
  }

  function updateHud(): void {
    if (mode !== 'play') return
    const next = buildHud()
    if (!lastHud || JSON.stringify(lastHud) !== JSON.stringify(next)) {
      lastHud = next
      events.onHud(next)
    }
  }

  function tickHud(dt: number): void {
    if (presentation) {
      hudThrottle += dt
      if (hudThrottle < HUD_THROTTLE_SECONDS) return
      hudThrottle = 0
    } else {
      hudThrottle = 0
    }
    updateHud()
  }

  function maybeEmitReels(level: number, pitch: number): void {
    if (mode !== 'play') return
    const levelChanged = Math.abs(level - lastLevel) > 0.02 || (level === 0 && lastLevel !== 0)
    const pitchChanged = Math.abs(pitch - lastPitch) > 0.02 || (pitch === 0 && lastPitch !== 0)
    if (levelChanged || pitchChanged) {
      lastLevel = level
      lastPitch = pitch
      events.onReels(level, pitch)
    }
  }

  // --- Win presentation ----------------------------------------------------------------------

  function buildGlows(outcome: SpinOutcome): PaylineGlow[] {
    const glows: PaylineGlow[] = outcome.lineWins.map((w) => ({ line: w.line, cells: w.cells, symbol: w.symbol }))
    if (outcome.scatter) glows.push({ line: -1, cells: outcome.scatter.cells, symbol: 'scatter' })
    return glows
  }

  function scheduleAutoContinue(hadWin: boolean): void {
    const wait = (hadWin ? AUTO_CONTINUE_AFTER_WIN_SECONDS : AUTO_CONTINUE_SECONDS) * qsScale()
    if (mode === 'attract') {
      if (shouldAutoSpin(session)) pendingAction = { remaining: wait, fn: attractContinue }
      else pendingAction = { remaining: ATTRACT_ROUND_GAP_SECONDS, fn: attractNewRound }
      return
    }
    if (shouldAutoSpin(session)) {
      pendingAction = { remaining: wait, fn: () => doSpin(false) }
    } else {
      pendingAction = null
      machine.setButtonLit('spin', canSpinNow())
    }
  }

  function endPresentation(): void {
    const hadWin = (presentation?.totalWin ?? 0) > 0
    presentation = null
    reels.setDim(false)
    reels.setWindowHighlight([], null)
    machine.setPaylineGlow([])
    machine.showWinLamp(false)
    machine.setTopperMode(session.freeSpins ? 'free' : 'idle')
    scheduleAutoContinue(hadWin)
  }

  function tickPresentation(dt: number): void {
    const p = presentation
    if (!p) return
    p.elapsed += dt
    const glowIdx = Math.min(p.glows.length - 1, Math.floor(p.elapsed / p.glowStep))
    if (glowIdx !== p.glowIndex) {
      p.glowIndex = glowIdx
      const glow = p.glows[glowIdx]!
      machine.setPaylineGlow([glow])
      reels.setWindowHighlight([...glow.cells], colorNumberFor(glow.symbol))
    }
    const progress = p.countUpDuration > 0 ? Math.min(1, p.elapsed / p.countUpDuration) : 1
    displayedWin = Math.round(p.totalWin * progress)
    if (p.elapsed >= p.duration) endPresentation()
  }

  function presentResult(outcome: SpinOutcome, awardedFreeSpins: boolean): void {
    machine.setButtonLit('spin', canSpinNow())
    const reaction = crowdReaction(outcome)

    if (outcome.totalWin === 0) {
      displayedWin = 0
      if (reaction) {
        crowd.react(reaction.kind, reaction.strength)
        if (mode === 'play') events.onSound(reaction.kind, reaction.strength)
      }
      machine.setTopperMode(session.freeSpins ? 'free' : 'idle')
      scheduleAutoContinue(false)
      return
    }

    const qs = qsScale()
    const glows = buildGlows(outcome)
    const bigPlus = outcome.tier === 'big' || outcome.tier === 'mega' || outcome.tier === 'jackpot'
    const countUpDuration = Math.min(3, 0.4 + (outcome.totalWin / outcome.bet) * 0.15) * qs
    const glowStep = GLOW_CYCLE_SECONDS * qs
    presentation = {
      elapsed: 0,
      glows,
      glowIndex: -1,
      glowStep,
      countUpDuration,
      duration: Math.max(glows.length * glowStep, countUpDuration),
      totalWin: outcome.totalWin,
    }
    reels.setDim(true)
    machine.showWinLamp(bigPlus || (reaction !== null && reaction.kind === 'cheer'))
    machine.setTopperMode(outcome.tier === 'jackpot' ? 'jackpot' : awardedFreeSpins ? 'free' : 'win')
    if (reaction) {
      crowd.react(reaction.kind, reaction.strength)
      if (mode === 'play') events.onSound(reaction.kind, reaction.strength)
      if (reaction.kind === 'cheer') confetti.burst(reaction.strength)
    }
  }

  // --- Spin choreography ---------------------------------------------------------------------

  function doSpin(silent: boolean): void {
    const seed = randomSeed()
    const transition = spinSession(session, seed)
    applyTransition(transition, silent)
    if (session.phase !== 'spinning' || !session.lastOutcome) return
    const outcome = session.lastOutcome

    presentation = null
    displayedWin = 0
    machine.setPaylineGlow([])
    reels.setWindowHighlight([], null)
    reels.setDim(false)
    machine.showWinLamp(false)

    const qs = qsScale()
    const anticipation = countSymbolInReels(outcome.window, [0, 1, 2], 'scatter') >= 2
    const seconds = anticipation
      ? [BASE_STOP_SECONDS[0]!, BASE_STOP_SECONDS[1]!, BASE_STOP_SECONDS[2]!, BASE_STOP_SECONDS[3]! + ANTICIPATION_EXTENSION_SECONDS, BASE_STOP_SECONDS[4]! + ANTICIPATION_EXTENSION_SECONDS]
      : [...BASE_STOP_SECONDS]

    reels.spin(outcome.stops, seconds, quickSpin)
    machine.pullLever(LEVER_PULL_SECONDS * qs)
    machine.setTopperMode('spin')
    machine.setButtonLit('spin', false)

    spinElapsed = 0
    nextReelStopIndex = 0
    spinStopTimes = seconds.map((s) => (quickSpin ? s / 2 : s))
    if (anticipation && !silent && mode === 'play') events.onSound('anticipation', 1)
  }

  function onReelsFullyStopped(): void {
    spinStopTimes = null
    if (session.phase !== 'spinning') return
    const transition = settleSession(session)
    const awardedFreeSpins = transition.commands.some((c) => c.type === 'freeSpinsAwarded')

    if (pendingModeSwitch) {
      session = transition.session
      const fn = pendingModeSwitch
      pendingModeSwitch = null
      fn()
      return
    }

    applyTransition(transition, mode !== 'play')
    if (session.lastOutcome) presentResult(session.lastOutcome, awardedFreeSpins)
  }

  function userSpin(): void {
    if (!canSpinNow()) return
    doSpin(false)
  }

  // --- Attract mode ----------------------------------------------------------------------------

  function attractContinue(): void {
    doSpin(true)
  }

  function attractNewRound(): void {
    if (isBroke(session)) applyTransition(refillSession(session), true)
    const rng = createRng(randomSeed())
    const coinValue = attractCoinValue(rng, session.bankroll)
    applyTransition(setCoinValueSession(session, coinValue), true)
    doSpin(true)
  }

  function resetDisplayState(): void {
    presentation = null
    displayedWin = 0
    pendingAction = null
    resultElapsed = 0
    spinStopTimes = null
    spinElapsed = 0
    nextReelStopIndex = 0
    reels.setWindowHighlight([], null)
    reels.setDim(false)
    machine.setPaylineGlow([])
    machine.showWinLamp(false)
    machine.setTopperMode('idle')
    crowd.calm()
    confetti.clear()
    lastLevel = 0
    lastPitch = 0
    lastHud = null
  }

  function beginAttract(): void {
    mode = 'attract'
    session = createSession(null)
    resetDisplayState()
    attractNewRound()
  }

  function beginPlay(save: SessionSave | null): void {
    mode = 'play'
    session = createSession(save)
    resetDisplayState()
    machine.setButtonLit('spin', true)
    updateHud()
  }

  function requestShowAttract(): void {
    if (reels.isSpinning()) pendingModeSwitch = beginAttract
    else beginAttract()
  }

  function requestStartSession(save: SessionSave | null): void {
    const start = (): void => beginPlay(save)
    if (reels.isSpinning() && mode === 'attract') {
      // The demo's spin has no credits riding on it: snap the reels so play starts at once.
      reels.stopNow()
      spinStopTimes = null
      pendingModeSwitch = null
      start()
      return
    }
    if (reels.isSpinning()) pendingModeSwitch = start
    else start()
  }

  // --- Pointer input (canvas raycast against the machine's named buttons) ---------------------

  const raycaster = new THREE.Raycaster()
  const pointerNdc = new THREE.Vector2()
  let pointerDown: { x: number; y: number } | null = null
  let hoveredButton: string | null = null

  function buttonAt(clientX: number, clientY: number): string | null {
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1))
    raycaster.setFromCamera(pointerNdc, camera)
    const hits = raycaster.intersectObject(machine.group, true)
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object
      while (o) {
        const button = o.userData.button
        if (typeof button === 'string') return button
        o = o.parent
      }
    }
    return null
  }

  function updateHoverButton(name: string | null): void {
    if (name === hoveredButton) return
    if (hoveredButton === 'bet' || hoveredButton === 'max') machine.setButtonLit(hoveredButton, false)
    hoveredButton = name
    if (name === 'bet' || name === 'max') machine.setButtonLit(name, true)
    canvas.style.cursor = name ? 'pointer' : ''
  }

  function activateButton(name: string): void {
    if (name === 'spin' || name === 'lever') {
      userSpin()
      return
    }
    if (mode !== 'play') return
    if (name === 'bet') {
      if (session.coinValue === COIN_VALUES[COIN_VALUES.length - 1]) applyTransition(setCoinValueSession(session, COIN_VALUES[0]!), false)
      else applyTransition(betUpSession(session), false)
    } else if (name === 'max') {
      applyTransition(maxBetSession(session), false)
    } else if (name === 'auto') {
      applyTransition(setAutoplaySession(session, session.autoplayRemaining > 0 ? 0 : 25), false)
    }
  }

  function handlePointerMove(e: PointerEvent): void {
    if (mode !== 'play') {
      updateHoverButton(null)
      return
    }
    updateHoverButton(buttonAt(e.clientX, e.clientY))
  }

  function handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return
    pointerDown = { x: e.clientX, y: e.clientY }
  }

  function handlePointerUp(e: PointerEvent): void {
    const down = pointerDown
    pointerDown = null
    if (!down || mode !== 'play') return
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
    if (moved > TAP_MAX_MOVE_PX) return
    const button = buttonAt(e.clientX, e.clientY)
    if (button) activateButton(button)
  }

  function handlePointerLeave(): void {
    pointerDown = null
    updateHoverButton(null)
  }

  canvas.addEventListener('pointermove', handlePointerMove)
  canvas.addEventListener('pointerdown', handlePointerDown)
  canvas.addEventListener('pointerup', handlePointerUp)
  canvas.addEventListener('pointercancel', handlePointerLeave)
  canvas.addEventListener('pointerleave', handlePointerLeave)

  // --- Resize --------------------------------------------------------------------------------

  function handleResize(): void {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height, false)
    composer.setSize(width, height)
    aspect = width / height
    camera.aspect = aspect
    camera.clearViewOffset()
    camera.updateProjectionMatrix()
    refitAllViews()
    applyViewOffset()
  }

  const resizeObserver = new ResizeObserver(() => handleResize())
  resizeObserver.observe(canvas)
  handleResize()

  // --- Quality auto step-down ------------------------------------------------------------------

  let smoothedFrameSeconds = 0
  let slowFrames = 0
  let settleFrames = QUALITY_SETTLE_FRAMES

  function applyQualityStep(): void {
    const step = QUALITY_STEPS[qualityStep]!
    const pixelRatio = Math.min(window.devicePixelRatio, step.pixelRatio)
    renderer.setPixelRatio(pixelRatio)
    composer.setPixelRatio(pixelRatio)
    bloomPass.enabled = step.bloom
    reelSpot.shadow.mapSize.setScalar(Math.min(SHADOW_MAP_SIZE, step.shadowMapSize))
    handleResize()
  }

  function watchFrameRate(frameSeconds: number): void {
    if (qualityPinned || qualityStep >= QUALITY_STEPS.length - 1) return
    if (settleFrames > 0) {
      settleFrames--
      smoothedFrameSeconds = frameSeconds
      return
    }
    smoothedFrameSeconds += (frameSeconds - smoothedFrameSeconds) * 0.1
    slowFrames = smoothedFrameSeconds > SLOW_FRAME_SECONDS ? slowFrames + 1 : 0
    if (slowFrames < SLOW_FRAMES_TO_STEP_DOWN) return
    qualityStep++
    slowFrames = 0
    settleFrames = QUALITY_SETTLE_FRAMES
    applyQualityStep()
  }

  // --- Main loop -------------------------------------------------------------------------------

  let rafId = 0
  let lastFrameTime = 0
  let hasLastFrameTime = false

  function animate(now: number): void {
    rafId = requestAnimationFrame(animate)
    if (!hasLastFrameTime) {
      hasLastFrameTime = true
      lastFrameTime = now
      return
    }
    const frameSeconds = (now - lastFrameTime) / 1000
    const dt = Math.min(MAX_FRAME_SECONDS, frameSeconds)
    lastFrameTime = now
    const simDt = paused ? 0 : dt

    if (simDt > 0) {
      if (spinStopTimes) {
        spinElapsed += simDt
        while (nextReelStopIndex < spinStopTimes.length && spinElapsed >= spinStopTimes[nextReelStopIndex]!) {
          const idx = nextReelStopIndex
          nextReelStopIndex++
          if (mode === 'play') events.onSound('reelStop', idx / 4)
        }
      }
      if (pendingAction) {
        pendingAction.remaining -= simDt
        if (pendingAction.remaining <= 0) {
          const fn = pendingAction.fn
          pendingAction = null
          fn()
        }
      }
      if (session.phase === 'result') resultElapsed += simDt
      if (presentation) tickPresentation(simDt)
    }

    simTime += simDt
    const reelState = reels.update(simDt, simTime)
    maybeEmitReels(reelState.level, reelState.pitch)
    const spinningNow = reels.isSpinning()
    if (wasSpinning && !spinningNow) onReelsFullyStopped()
    wasSpinning = spinningNow

    room.update(simTime)
    machine.update(simDt, simTime)
    crowd.update(simDt, simTime)
    confetti.update(simDt)

    watchFrameRate(frameSeconds)
    updateCamera(simDt)
    tickHud(simDt)

    composer.render()
  }

  beginAttract()
  rafId = requestAnimationFrame(animate)

  // --- Public API --------------------------------------------------------------------------------

  return {
    startSession(save: SessionSave | null): void {
      requestStartSession(save)
    },

    showAttract(): void {
      requestShowAttract()
    },

    spin(): void {
      userSpin()
    },

    setCoinValue(value: CoinValue): void {
      if (mode === 'play') applyTransition(setCoinValueSession(session, value), false)
    },

    betUp(): void {
      if (mode === 'play') applyTransition(betUpSession(session), false)
    },

    betDown(): void {
      if (mode === 'play') applyTransition(betDownSession(session), false)
    },

    maxBet(): void {
      if (mode === 'play') applyTransition(maxBetSession(session), false)
    },

    setAutoplay(count: number): void {
      if (mode === 'play') applyTransition(setAutoplaySession(session, count), false)
    },

    refill(): void {
      if (mode === 'play') applyTransition(refillSession(session), false)
    },

    setCameraView(view: CameraView): void {
      cameraView = view
    },

    setQuickSpin(on: boolean): void {
      quickSpin = on
    },

    setViewInsets(next: ViewInsets): void {
      const clean = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0)
      insets = { left: clean(next.left), top: clean(next.top), right: clean(next.right), bottom: clean(next.bottom) }
      refitAllViews()
      applyViewOffset()
    },

    setPaused(next: boolean): void {
      paused = next
    },

    resize(): void {
      handleResize()
    },

    dispose(): void {
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointercancel', handlePointerLeave)
      canvas.removeEventListener('pointerleave', handlePointerLeave)

      machine.dispose()
      reels.dispose()
      room.dispose()
      crowd.dispose()
      confetti.dispose()

      renderPass.dispose()
      bloomPass.dispose()
      outputPass.dispose()
      composer.dispose()
      environmentTarget.dispose()
      renderer.dispose()
    },
  }
}
