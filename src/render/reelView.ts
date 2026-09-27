/**
 * The five physical reels: cylinders behind the glass whose axis runs along world `x`, one per
 * column, each wrapped with a *window* of its strip's texture. Pure three.js: state (which stop
 * each reel is spinning toward, how far along the spin animation it is) lives only in this
 * module's closures, advanced by `update(dt, time)`.
 *
 * Why a window, not the whole strip: `REEL_RADIUS` (9 in, fixed by the cabinet's depth) gives a
 * circumference far too small to spread 30-34 strip symbols around at `CELL_HEIGHT` (4.5 in)
 * each - they'd come out tiny and the window would show many rows at once. Instead the cylinder
 * is built at a smaller radius, `REEL_VISIBLE_RADIUS`, sized so its circumference holds exactly
 * `REEL_VISIBLE_CELLS` (12) symbols at `CELL_HEIGHT` each, and the strip texture is addressed through
 * `repeat`/`offset` so only 12 consecutive strip cells - the three showing plus a few to blur
 * through on either side - are wrapped around that circumference at any time.
 *
 * Rotation-to-strip-index mapping (read this before touching `spin`, `symbolAtRow`, or the
 * texture rotation in `symbolTextures.ts`):
 *
 * `CylinderGeometry` builds its lateral surface with the height axis along local `+y` and, at
 * local-height fraction `v` (0 at the top cap, 1 at the bottom), a circumferential angle
 * `theta = u * 2*PI` placing the vertex at local `(radius*sin(theta), y, radius*cos(theta))`, uv
 * `(u, 1 - v)`. `theta = 0` (`u = 0`) is therefore the point on local `+z`.
 *
 * Each reel mesh carries a fixed alignment quaternion, `ALIGN_QUAT`, a -90 degree rotation about
 * `z`. Composed with the identity `y`-rotation, that sends local `+y` (the cylinder's axis) to
 * world `+x` and leaves local `+z` (the `theta = 0` point) on world `+z` - i.e. after only the
 * fixed alignment, the geometry's circumference lies in the world Y-Z plane, with `theta = 0`
 * already facing the player. Spinning the reel is then a further rotation by angle `phi` about
 * world `+x`, applied on the *outside* of the alignment (`quaternion = spin(phi) * ALIGN_QUAT`,
 * i.e. `ALIGN_QUAT` applied to a local point first, `spin(phi)` second): working through both
 * rotations, a vertex at circumference angle `theta` ends up at world
 * `(y_local, -radius*sin(theta + phi), radius*cos(theta + phi))` - the same shape as the
 * unrotated circle, just with `theta` and `phi` added together. World Z is greatest (the symbol
 * facing the player) when `theta + phi = 0`; world Y is positive (above the middle row) for
 * `theta + phi` slightly negative, and negative (below) for slightly positive - so, going around
 * the reel, increasing `theta` scrolls a symbol downward through the window.
 *
 * Where a symbol's `theta` comes from - the texture UV transform:
 *
 * `symbolTextures.ts` draws strip index `i` (0 at the canvas top, one strip cell per
 * `1 / strip.length` of the canvas height) into a tall canvas and sets `texture.rotation = PI/2`
 * about `center = (0.5, 0.5)`. Three.js builds the UV transform matrix as (`Matrix3.setUvTransform`,
 * `c = cos(rotation)`, `s = sin(rotation)`, `sx/sy` = `repeat.x/y`, `tx/ty` = `offset.x/y`):
 * `u' = sx*c*u + sx*s*v + (-sx*(c*cx+s*cy)+cx+tx)`,
 * `v' = -sy*s*u + sy*c*v + (-sy*(-s*cx+c*cy)+cy+ty)` - note this is a *clockwise* screen rotation
 * of the sampling point, not the naive `(u-cx)cos-(v-cy)sin` CCW formula (the two disagree in the
 * sign of the cross terms; using the wrong one is exactly what previously left every symbol
 * rotated 180 degrees). With `rotation = PI/2` (`c=0, s=1`), `cx=cy=0.5`: `u' = v`,
 * `v' = 1 - u` (`u` here is the geometry's own uv.x, i.e. `theta / 2*PI`). `CanvasTexture`'s
 * default `flipY = true` then samples `v' = 1` at the canvas's top row and `v' = 0` at its bottom
 * row, so the canvas-row fraction from the top is `p = 1 - v' = u = theta / 2*PI` - i.e. `theta`
 * runs directly with canvas row, matching the top-to-bottom, index-0-at-top draw order.
 *
 * The window: `repeat.y = REEL_VISIBLE_CELLS / strip.length` compresses that whole relationship so one
 * full turn (`u`: 0 to 1) only sweeps `p` through `REEL_VISIBLE_CELLS` strip cells, not all of them,
 * and `offset.y` (`computeOffsetY`, solved from the `u'/v'` formulas above so a *wrapped position*
 * `w` in `[0, REEL_VISIBLE_CELLS)` lands at canvas-row fraction `(k + w + 0.5) / strip.length`, i.e.
 * strip index `k + w`) picks which strip index, `k`, sits at wrapped position 0. `wrapT =
 * RepeatWrapping` lets that sampled band cross the canvas's own top/bottom seam - needed whenever
 * the chosen window wraps past the end of the strip - and is seamless there because the canvas
 * already draws one full, naturally-wrapping copy of the strip.
 *
 * Because a wrapped position's representative angle is `theta(w) = (w + 0.5) * VISIBLE_STEP`
 * (`VISIBLE_STEP = 2*PI / REEL_VISIBLE_CELLS`) regardless of `strip.length`, and `spin` always chooses
 * `k` (`windowStartForStop`) so the target cells `stop, stop + 1, stop + 2` sit at wrapped
 * positions `WINDOW_MIDDLE - 1, WINDOW_MIDDLE, WINDOW_MIDDLE + 1`, the settled rotation needed to
 * bring wrapped position `WINDOW_MIDDLE` to `theta + phi = 0` is the same for every reel and every
 * spin: `SETTLED_PHI = -(WINDOW_MIDDLE + 0.5) * VISIBLE_STEP`. That also parks the texture's own
 * seam (`theta = 0`) near `theta + phi = -SETTLED_PHI`, i.e. close to the back of the cylinder,
 * out of the window's view. `symbolAtRow` inverts the same formulas (angle -> wrapped position,
 * wrapped position -> strip index via the *currently applied* `k`) to read a strip index back off
 * the live rotation.
 *
 * The window (`offset.y`) only needs to reach its target strip position by the time the reel
 * is recognisably slowing down, since it is a blur before then; `spin` computes the target `k`
 * immediately but `update` only writes it to the texture once the reel leaves the acceleration
 * phase (`applyOffset`), and `stopNow` applies it immediately if a spin never got that far.
 */

import * as THREE from 'three'
import type { Cell } from '../game/types.ts'
import { REEL_COUNT, ROW_COUNT } from '../game/types.ts'
import { REEL_STRIPS } from '../game/reels.ts'
import { CELL_HEIGHT, CELL_WIDTH, REEL_AXIS_Z, REEL_WINDOW_Y, cellPosition } from './layout.ts'
import { makeReelStripBlurTexture, makeReelStripTexture } from './symbolTextures.ts'

export interface ReelView {
  group: THREE.Group
  /** Starts a spin toward `stops[reel]`, each reel stopping at its own `seconds[reel]`. */
  spin(stops: number[], seconds: number[], quick: boolean): void
  isSpinning(): boolean
  /** Snaps every reel straight to the last requested `stops`, instantly, no animation. */
  stopNow(): void
  /** Draws a pulsing gold frame over each cell in `cells`, in `color`; `null` clears every frame. */
  setWindowHighlight(cells: Cell[], color: number | null): void
  /** Darkens the reels while a win tallies. */
  setDim(dim: boolean): void
  /** Advances the spin animation by `dt` seconds; `time` drives purely cosmetic pulsing. */
  update(dt: number, time: number): { level: number; pitch: number }
  /** Test/debug hook: the strip index currently facing the window at `row` (0 top, 2 bottom). */
  symbolAtRow(reel: number, row: number): number
  dispose(): void
}

// -------------------------------------------------------------------------------------------
// Tuning
// -------------------------------------------------------------------------------------------

const RADIAL_SEGMENTS = 64
const ACCEL_TIME = 0.25
const DECEL_TIME = 0.35
const SPRING_TIME = 0.3
const OVERSHOOT = 0.12
const BASE_REVOLUTIONS_PER_SECOND = 3
const QUICK_SPEED_MULT = 1.6
const PULSE_HZ = 1.2
const DIM_COLOR_SCALE = 0.45
const DIM_EMISSIVE_INTENSITY = 0.04
const LIT_EMISSIVE_INTENSITY = 0.12
const HIGHLIGHT_COLOR = '#f3d27a'
/** Cream strips read as paper, not plastic, so the reel material is duller than a bare gloss. */
const REEL_ROUGHNESS = 0.6
const HIGHLIGHT_TEXTURE_SIZE = 128
/** How much smaller the blurred-face cylinder's radius is than the sharp face's. */
const BLUR_MESH_RADIUS_OFFSET = 0.03
/** Blur fades in starting at this fraction of full speed, and is fully opaque by +0.5 more. */
const BLUR_FADE_START = 0.35
const BLUR_FADE_RANGE = 0.5
/** How long the post-stop backlight flash takes to decay back to the base emissive intensity. */
const FLASH_DECAY_TIME = 0.35

/** How many strip cells are wrapped around the reel's circumference at once. See the header. */
export const REEL_VISIBLE_CELLS = 12
/** Radius whose circumference holds `REEL_VISIBLE_CELLS` symbols at `CELL_HEIGHT` each (~8.59 in). */
export const REEL_VISIBLE_RADIUS = (REEL_VISIBLE_CELLS * CELL_HEIGHT) / (2 * Math.PI)
const VISIBLE_STEP = (2 * Math.PI) / REEL_VISIBLE_CELLS
/** Wrapped position (0..11) that sits at the window's middle row once a reel is settled. */
const WINDOW_MIDDLE = REEL_VISIBLE_CELLS / 2 - 1
/** Fixed settle angle: see the header - the same for every reel and every spin. */
const SETTLED_PHI = -(WINDOW_MIDDLE + 0.5) * VISIBLE_STEP

const X_AXIS = new THREE.Vector3(1, 0, 0)
/** See the header: a fixed -90 degree turn about `z` that puts the cylinder's axis on world `x`. */
const ALIGN_QUAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2)

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** The strip index that should sit at wrapped position 0 so `stop + 1` lands on `WINDOW_MIDDLE`. */
function windowStartForStop(stop: number, stripLength: number): number {
  return mod(stop + 1 - WINDOW_MIDDLE, stripLength)
}

/** `texture.offset.y` that puts strip index `k` at wrapped position 0. See the header derivation. */
function computeOffsetY(k: number, stripLength: number): number {
  const repeat = REEL_VISIBLE_CELLS / stripLength
  return 0.5 - repeat / 2 - k / stripLength
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function makeHighlightRingTexture(): THREE.CanvasTexture {
  const size = HIGHLIGHT_TEXTURE_SIZE
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for reel highlight texture')
  ctx.clearRect(0, 0, size, size)
  ctx.strokeStyle = HIGHLIGHT_COLOR
  ctx.lineWidth = size * 0.09
  ctx.shadowColor = HIGHLIGHT_COLOR
  ctx.shadowBlur = size * 0.18
  roundRectPath(ctx, size * 0.08, size * 0.08, size * 0.84, size * 0.84, size * 0.16)
  ctx.stroke()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

// -------------------------------------------------------------------------------------------
// Per-reel spin state
// -------------------------------------------------------------------------------------------

type ReelPhase = 'accelerating' | 'constant' | 'decelerating' | 'settling' | 'stopped'

interface ReelState {
  phase: ReelPhase
  elapsed: number
  /** Current rotation about world `x`, radians (unbounded, keeps accumulating across spins). */
  phi: number
  /** Current angular speed, radians/second (for the audio pitch only). */
  omega: number
  phi0: number
  fullSpeed: number
  stopTime: number
  decelStart: number
  phiConstantStart: number
  phiDecelStart: number
  targetPhi: number
  overshootPhi: number
  /** Strip index currently at wrapped position 0 on the texture (already applied). */
  appliedOffsetK: number
  /** Strip index this spin wants at wrapped position 0, once it is safe to reveal. */
  pendingOffsetK: number
  /** Whether `pendingOffsetK` has been written to the texture yet. */
  offsetApplied: boolean
}

function initialReelState(): ReelState {
  return {
    phase: 'stopped',
    elapsed: 0,
    phi: 0,
    omega: 0,
    phi0: 0,
    fullSpeed: 0,
    stopTime: 0,
    decelStart: 0,
    phiConstantStart: 0,
    phiDecelStart: 0,
    targetPhi: 0,
    overshootPhi: 0,
    appliedOffsetK: 0,
    pendingOffsetK: 0,
    offsetApplied: true,
  }
}

function advanceReelState(state: ReelState, dt: number): void {
  if (state.phase === 'stopped') return
  state.elapsed += dt
  const t = state.elapsed
  if (t < ACCEL_TIME) {
    state.omega = state.fullSpeed * (t / ACCEL_TIME)
    state.phi = state.phi0 - (state.fullSpeed * (t * t)) / (2 * ACCEL_TIME)
    state.phase = 'accelerating'
  } else if (t < state.decelStart) {
    state.omega = state.fullSpeed
    state.phi = state.phiConstantStart - state.fullSpeed * (t - ACCEL_TIME)
    state.phase = 'constant'
  } else if (t < state.stopTime) {
    const span = Math.max(state.stopTime - state.decelStart, 1e-6)
    const u = (t - state.decelStart) / span
    const eased = 1 - (1 - u) * (1 - u)
    state.omega = state.fullSpeed * (1 - u)
    state.phi = state.phiDecelStart + (state.overshootPhi - state.phiDecelStart) * eased
    state.phase = 'decelerating'
  } else if (t < state.stopTime + SPRING_TIME) {
    const u = (t - state.stopTime) / SPRING_TIME
    const damped = Math.exp(-4 * u) * Math.cos(2 * Math.PI * 1.5 * u)
    state.phi = state.targetPhi - OVERSHOOT * damped
    state.omega = 0
    state.phase = 'settling'
  } else {
    state.phi = state.targetPhi
    state.omega = 0
    state.phase = 'stopped'
  }
}

// -------------------------------------------------------------------------------------------
// Assembly
// -------------------------------------------------------------------------------------------

interface ReelInstance {
  group: THREE.Group
  material: THREE.MeshStandardMaterial
  texture: THREE.CanvasTexture
  geometry: THREE.CylinderGeometry
  /** Second, always-blurred face shown through the sharp face while the reel is at speed. */
  blurMaterial: THREE.MeshStandardMaterial
  blurTexture: THREE.CanvasTexture
  blurGeometry: THREE.CylinderGeometry
  stripLength: number
  state: ReelState
  /** 1 right after the reel stops, decaying to 0: drives the backlight flash. */
  flash: number
}

interface HighlightCell {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
}

function buildReel(reel: number, capMaterial: THREE.Material): ReelInstance {
  const strip = REEL_STRIPS[reel]
  const texture = makeReelStripTexture(strip)
  texture.repeat.set(1, REEL_VISIBLE_CELLS / strip.length)
  texture.offset.y = computeOffsetY(0, strip.length)
  const blurTexture = makeReelStripBlurTexture(strip)
  blurTexture.repeat.set(1, REEL_VISIBLE_CELLS / strip.length)
  blurTexture.offset.y = computeOffsetY(0, strip.length)
  const height = CELL_WIDTH - 0.3
  const geometry = new THREE.CylinderGeometry(REEL_VISIBLE_RADIUS, REEL_VISIBLE_RADIUS, height, RADIAL_SEGMENTS, 1, true)
  const blurRadius = REEL_VISIBLE_RADIUS - BLUR_MESH_RADIUS_OFFSET
  const blurGeometry = new THREE.CylinderGeometry(blurRadius, blurRadius, height, RADIAL_SEGMENTS, 1, true)
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    emissiveMap: texture,
    emissive: 0xffffff,
    emissiveIntensity: LIT_EMISSIVE_INTENSITY,
    roughness: REEL_ROUGHNESS,
    transparent: true,
    // The blurred mesh sits just behind (smaller radius) and writes depth for both.
    depthWrite: false,
  })
  const blurMaterial = new THREE.MeshStandardMaterial({
    map: blurTexture,
    emissiveMap: blurTexture,
    emissive: 0xffffff,
    emissiveIntensity: LIT_EMISSIVE_INTENSITY,
    roughness: REEL_ROUGHNESS,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.renderOrder = 1
  const blurMesh = new THREE.Mesh(blurGeometry, blurMaterial)
  blurMesh.castShadow = true
  blurMesh.receiveShadow = true

  const capGeometry = new THREE.CircleGeometry(REEL_VISIBLE_RADIUS, 32)
  const topCapGeometry = capGeometry.clone()
  topCapGeometry.rotateX(-Math.PI / 2)
  const topCap = new THREE.Mesh(topCapGeometry, capMaterial)
  topCap.position.y = height / 2
  topCap.receiveShadow = true
  const bottomCapGeometry = capGeometry.clone()
  bottomCapGeometry.rotateX(Math.PI / 2)
  const bottomCap = new THREE.Mesh(bottomCapGeometry, capMaterial)
  bottomCap.position.y = -height / 2
  bottomCap.receiveShadow = true
  capGeometry.dispose()

  const group = new THREE.Group()
  group.position.set((reel - 2) * CELL_WIDTH, REEL_WINDOW_Y, REEL_AXIS_Z)
  group.add(mesh, blurMesh, topCap, bottomCap)

  return {
    group,
    material,
    texture,
    geometry,
    blurMaterial,
    blurTexture,
    blurGeometry,
    stripLength: strip.length,
    state: initialReelState(),
    flash: 0,
  }
}

export function createReelView(): ReelView {
  const group = new THREE.Group()

  const capMaterial = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.85 })
  const reels: ReelInstance[] = []
  for (let reel = 0; reel < REEL_COUNT; reel++) {
    const instance = buildReel(reel, capMaterial)
    reels.push(instance)
    group.add(instance.group)
  }

  const ringTexture = makeHighlightRingTexture()
  const highlightCells: HighlightCell[] = []
  const highlightWidth = CELL_WIDTH * 0.88
  const highlightHeight = CELL_HEIGHT * 0.88
  for (let reel = 0; reel < REEL_COUNT; reel++) {
    for (let row = 0; row < ROW_COUNT; row++) {
      const geometry = new THREE.PlaneGeometry(highlightWidth, highlightHeight)
      const material = new THREE.MeshBasicMaterial({
        map: ringTexture,
        color: 0xf3d27a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(geometry, material)
      const position = cellPosition(reel, row)
      mesh.position.set(position.x, position.y, position.z + 0.08)
      mesh.visible = false
      group.add(mesh)
      highlightCells.push({ mesh, material })
    }
  }

  let currentFullSpeed = 0
  /** Tracked so `update`/`stopNow` can recompute emissive intensity without re-deriving it from setDim. */
  let dimmed = false

  function baseEmissiveIntensity(): number {
    return dimmed ? DIM_EMISSIVE_INTENSITY : LIT_EMISSIVE_INTENSITY
  }

  function applyOffset(instance: ReelInstance, k: number): void {
    const offsetY = computeOffsetY(k, instance.stripLength)
    instance.texture.offset.y = offsetY
    instance.blurTexture.offset.y = offsetY
    instance.state.appliedOffsetK = k
    instance.state.offsetApplied = true
  }

  function spin(stops: number[], seconds: number[], quick: boolean): void {
    currentFullSpeed = BASE_REVOLUTIONS_PER_SECOND * Math.PI * 2 * (quick ? QUICK_SPEED_MULT : 1)
    for (let reel = 0; reel < REEL_COUNT; reel++) {
      const instance = reels[reel]
      const stopTime = quick ? seconds[reel] / 2 : seconds[reel]
      const phi0 = instance.state.phi
      // See the header: the settle angle is the same fixed constant for every reel and spin,
      // since the per-stop information lives entirely in which strip index the texture window
      // (`pendingOffsetK`) puts at the window's middle.
      const minTravel = currentFullSpeed * stopTime * 0.6
      const travel = minTravel + mod(phi0 - SETTLED_PHI - minTravel, Math.PI * 2)
      const targetPhi = phi0 - travel
      const decelStart = Math.max(ACCEL_TIME, stopTime - DECEL_TIME)
      const phiConstantStart = phi0 - (currentFullSpeed * ACCEL_TIME) / 2
      const phiDecelStart = phiConstantStart - currentFullSpeed * (decelStart - ACCEL_TIME)
      instance.state = {
        phase: 'accelerating',
        elapsed: 0,
        phi: phi0,
        omega: 0,
        phi0,
        fullSpeed: currentFullSpeed,
        stopTime,
        decelStart,
        phiConstantStart,
        phiDecelStart,
        targetPhi,
        overshootPhi: targetPhi - OVERSHOOT,
        appliedOffsetK: instance.state.appliedOffsetK,
        pendingOffsetK: windowStartForStop(stops[reel], instance.stripLength),
        offsetApplied: false,
      }
    }
  }

  function isSpinning(): boolean {
    return reels.some((instance) => instance.state.phase !== 'stopped')
  }

  function stopNow(): void {
    for (const instance of reels) {
      if (!instance.state.offsetApplied) applyOffset(instance, instance.state.pendingOffsetK)
      instance.state.phi = instance.state.targetPhi
      instance.state.omega = 0
      instance.state.phase = 'stopped'
      instance.group.quaternion.setFromAxisAngle(X_AXIS, instance.state.phi).multiply(ALIGN_QUAT)
      instance.material.opacity = 1
    }
  }

  function setWindowHighlight(cells: Cell[], color: number | null): void {
    for (const highlight of highlightCells) highlight.mesh.visible = false
    if (color === null) return
    for (const cell of cells) {
      const index = cell.reel * ROW_COUNT + cell.row
      const highlight = highlightCells[index]
      if (!highlight) continue
      highlight.mesh.visible = true
      highlight.material.color.setHex(color)
    }
  }

  function setDim(dim: boolean): void {
    dimmed = dim
    const base = baseEmissiveIntensity()
    for (const instance of reels) {
      instance.material.color.setScalar(dim ? DIM_COLOR_SCALE : 1)
      instance.blurMaterial.color.setScalar(dim ? DIM_COLOR_SCALE : 1)
      instance.material.emissiveIntensity = base + 0.6 * instance.flash
      instance.blurMaterial.emissiveIntensity = base + 0.6 * instance.flash
    }
  }

  function update(dt: number, time: number): { level: number; pitch: number } {
    let movingCount = 0
    let speedSum = 0
    const base = baseEmissiveIntensity()
    for (const instance of reels) {
      const wasStopped = instance.state.phase === 'stopped'
      advanceReelState(instance.state, dt)
      if (!instance.state.offsetApplied && instance.state.phase !== 'accelerating') {
        applyOffset(instance, instance.state.pendingOffsetK)
      }
      instance.group.quaternion.setFromAxisAngle(X_AXIS, instance.state.phi).multiply(ALIGN_QUAT)
      if (instance.state.phase !== 'stopped') {
        movingCount += 1
        speedSum += instance.state.omega
      }
      if (instance.state.phase === 'stopped' && !wasStopped) instance.flash = 1
      instance.flash = Math.max(0, instance.flash - dt / FLASH_DECAY_TIME)

      const blurAmount =
        instance.state.phase === 'stopped'
          ? 0
          : clamp01((Math.abs(instance.state.omega) / instance.state.fullSpeed - BLUR_FADE_START) / BLUR_FADE_RANGE)
      instance.material.opacity = instance.state.phase === 'stopped' ? 1 : 1 - blurAmount

      const emissiveIntensity = base + 0.6 * instance.flash
      instance.material.emissiveIntensity = emissiveIntensity
      instance.blurMaterial.emissiveIntensity = emissiveIntensity
    }
    for (const highlight of highlightCells) {
      if (!highlight.mesh.visible) continue
      highlight.material.opacity = 0.55 + 0.35 * Math.sin(time * 2 * Math.PI * PULSE_HZ)
    }
    const level = movingCount / REEL_COUNT
    const pitch = movingCount > 0 && currentFullSpeed > 0 ? speedSum / movingCount / currentFullSpeed : 0
    return { level, pitch }
  }

  function symbolAtRow(reel: number, row: number): number {
    const instance = reels[reel]
    const raw = row - 1 - instance.state.phi / VISIBLE_STEP - 0.5
    const wrapped = Math.round(mod(raw, REEL_VISIBLE_CELLS))
    return mod(instance.state.appliedOffsetK + wrapped, instance.stripLength)
  }

  function dispose(): void {
    for (const instance of reels) {
      instance.geometry.dispose()
      instance.material.dispose()
      instance.texture.dispose()
      instance.blurGeometry.dispose()
      instance.blurMaterial.dispose()
      instance.blurTexture.dispose()
      for (const child of instance.group.children) {
        if (child instanceof THREE.Mesh && child.geometry !== instance.geometry && child.geometry !== instance.blurGeometry) {
          child.geometry.dispose()
        }
      }
    }
    capMaterial.dispose()
    ringTexture.dispose()
    for (const highlight of highlightCells) {
      highlight.mesh.geometry.dispose()
      highlight.material.dispose()
    }
  }

  return { group, spin, isSpinning, stopNow, setWindowHighlight, setDim, update, symbolAtRow, dispose }
}
