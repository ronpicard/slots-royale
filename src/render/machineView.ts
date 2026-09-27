/**
 * The cabinet: the whole upright slot machine as one group, built from primitives and canvas
 * textures (no image files). World space, inches, `y` up; the cabinet is centred on `x = 0` with
 * its back at `CABINET_MIN_Z` and its glass reel window facing `+z` (the player). Every position
 * comes from `./layout.ts` - nothing here hard-codes a number `layout.ts` already names.
 *
 * Construction: the front face is a picture frame built from four boxes (a lower body below the
 * window, a header above it, and two side pillars beside it) so the window opening is a real gap
 * clear through the cabinet's depth, not a texture trick. A gold bezel sits proud of that opening,
 * a glass pane (`MeshPhysicalMaterial`, transmission) covers it, and a thin black grille just
 * behind the glass divides it into the 5x3 cell grid so the reel cylinders (built by
 * `./reelView.ts`, not this file) read as fifteen distinct windows rather than one blurred slot.
 * Gold payline plaques (1-10 down the left pillar, 11-20 down the right) flank the window. Above
 * the cabinet, a backlit topper carries the marquee sign and a chasing bulb border (`setTopperMode`
 * changes their colour and chase speed) plus a beacon dome (`showWinLamp`). A sloped button deck
 * holds the SPIN/BET/MAX BET/AUTO buttons, a coin slot and a bill acceptor; a chrome tray and a
 * brass kick plate sit below it. A lever pivots on the cabinet's right side (`pullLever` animates
 * the pull-and-return). `setPaylineGlow` draws a glowing tube through a winning line's cells and
 * lights its number plaque.
 *
 * Raycast targets: the engine (`Engine.ts`) hit-tests pointer input against named meshes. The
 * SPIN button's dome cap, the BET button's dome cap, the MAX BET button's dome cap, the AUTO
 * button's dome cap, and the lever's ball knob each carry `mesh.name` ('spin' / 'bet' / 'max' /
 * 'auto' / 'lever') and `mesh.userData.button` set to the same string, so a raycast intersection's
 * `object.userData.button` names the control to act on regardless of which mesh in the hierarchy
 * was hit. Each cap's printed label is a separate mesh with `raycast` disabled so picks always
 * land on the cap underneath.
 *
 * `setPaylineGlow`'s shape: the compressed spec for this method reads `setPaylineGlow(lines:
 * number[], cells per line, color)`. Read literally that's three independent arguments, but the
 * spec also says the tube's colour comes from `SYMBOL_COLOR` (keyed by the paying `SymbolId`) and
 * that a payline number is only used to light its plaque - and `LineWin` (`../game/types.ts`)
 * already bundles a line's `cells` with its paying `symbol`. So this file bundles the three into
 * one list, `PaylineGlow[]`, so the caller (which already holds a `LineWin`) does not need to
 * resolve `SYMBOL_COLOR` itself or thread a separate parallel array: `machineView` is the only
 * place that imports `SYMBOL_COLOR`, and it does the lookup per entry. Passing `[]` clears every
 * glow and plaque light.
 */

import * as THREE from 'three'
import type { Cell, SymbolId } from '../game/types.ts'
import {
  CABINET_WIDTH,
  CABINET_HEIGHT,
  CABINET_DEPTH,
  CABINET_MIN_X,
  CABINET_MAX_X,
  CABINET_MIN_Z,
  CABINET_MAX_Z,
  REEL_WINDOW_Y,
  REEL_WINDOW_Z,
  REEL_WINDOW_WIDTH,
  REEL_WINDOW_HEIGHT,
  CELL_WIDTH,
  CELL_HEIGHT,
  TOPPER_Y,
  TOPPER_HEIGHT,
  DECK_Y,
  DECK_Z,
  LEVER_X,
  LEVER_Y,
  TRAY_Y,
  cellPosition,
} from './layout.ts'
import { makeBrushedMetalBump, makeBrushedMetalRoughness, makePebbleBump, makeScratchRoughness } from './materialTextures.ts'
import { REEL_VISIBLE_CELLS, REEL_VISIBLE_RADIUS } from './reelView.ts'
import { SYMBOL_COLOR } from './symbolTextures.ts'

export type TopperMode = 'idle' | 'spin' | 'win' | 'jackpot' | 'free'

/** One payline currently glowing: see the file header for why `line`, `cells` and the paying
 *  `symbol` travel together instead of as `setPaylineGlow`'s three separately-described arguments. */
export interface PaylineGlow {
  /** 0-based payline index (0-19); only used to light the matching number plaque. */
  line: number
  /** The five cells (reel 0..4) the glow tube runs through, in reel order. */
  cells: readonly Cell[]
  /** The symbol that paid, so the glow reads in `SYMBOL_COLOR[symbol]`. */
  symbol: SymbolId
}

export interface MachineView {
  /** World space, positioned so the cabinet sits on the floor centred at `x = 0`. */
  group: THREE.Group
  setTopperMode(mode: TopperMode): void
  /** Pulls the lever down and springs it back over `seconds`. */
  pullLever(seconds: number): void
  /** Lines glowing right now (the caller cycles winning lines one at a time); `[]` clears all. */
  setPaylineGlow(active: readonly PaylineGlow[]): void
  setButtonLit(name: 'spin' | 'bet' | 'max', lit: boolean): void
  showWinLamp(on: boolean): void
  /** Starts a highlight sweep across the reel window's glass, travelling left to right over `seconds`. */
  sweepGlass(seconds: number): void
  update(dt: number, time: number): void
  dispose(): void
}

// -------------------------------------------------------------------------------------------
// Palette and small helpers
// -------------------------------------------------------------------------------------------

const BLACK_LACQUER = '#0b0a0c'
const MASK_BLACK = '#050506'
const GOLD = '#d4af37'
const GOLD_BRIGHT = '#f3d27a'
const BURGUNDY_DEEP = '#4a1420'
const BRASS = '#c9a54a'
const CHROME = '#d8dade'
const RED_BUTTON = '#c81f2f'
const RED_BUTTON_LIT = '#ff3b4d'
const AMBER_BUTTON = '#e0a526'
const AMBER_BUTTON_EMISSIVE = '#f0b43a'
const VIOLET_BUTTON = '#7a3fb8'
const VIOLET_BUTTON_EMISSIVE = '#9a66e0'
const GREEN_LED = '#37e07a'
const DISPLAY_FONT = '"Playfair Display", Didot, Georgia, serif'
const TOPPER_FONT = '"Didot", "Playfair Display", Georgia, serif'

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t)
  return 1 - u * u * u
}

interface Disposable {
  dispose(): void
}

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for machine texture')
  return { canvas, ctx }
}

function finishTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

// -------------------------------------------------------------------------------------------
// Window / bezel geometry, derived once from `layout.ts` so nothing below repeats the maths.
// -------------------------------------------------------------------------------------------

const WIN_HALF_W = REEL_WINDOW_WIDTH / 2
const WIN_HALF_H = REEL_WINDOW_HEIGHT / 2
const WIN_TOP = REEL_WINDOW_Y + WIN_HALF_H
const WIN_BOTTOM = REEL_WINDOW_Y - WIN_HALF_H
const WIN_LEFT = -WIN_HALF_W
const WIN_RIGHT = WIN_HALF_W
const CABINET_CENTER_Z = (CABINET_MIN_Z + CABINET_MAX_Z) / 2
const BEZEL_WIDTH = 1
const BEZEL_DEPTH = 0.6
const PAYLINE_TABS_PER_SIDE = 10
const TOPPER_WIDTH = CABINET_WIDTH * 0.85
const TOPPER_DEPTH = 6
const DECK_ANGLE = (-25 * Math.PI) / 180
const DECK_WIDTH = CABINET_WIDTH - 4
const DECK_PANEL_HEIGHT = 14
const LEVER_PULL_ANGLE = 0.85

const BURGUNDY_LACQUER = '#3a0d17'
const PINSTRIPE_WIDTH = 0.18
const PINSTRIPE_PROUD = 0.06
/** How far each pinstripe sits in from the outer edge of the front face. */
const PINSTRIPE_INSET = 3.2
/** The burgundy panel sits on the lower cabinet face, between the coin tray and the kick, where the deck does not hide it. */
const BELLY_PANEL_CENTER_Y = 11
const BELLY_PANEL_HEIGHT = 13
const BELLY_PANEL_PROUD = 0.12

// -------------------------------------------------------------------------------------------
// Canvas texture painters
// -------------------------------------------------------------------------------------------

function paintTopperSign(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height)
  const bg = ctx.createLinearGradient(0, 0, 0, height)
  bg.addColorStop(0, BURGUNDY_DEEP)
  bg.addColorStop(1, '#5a1424')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = GOLD
  ctx.lineWidth = height * 0.05
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth)
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(243, 210, 122, 0.85)'
  ctx.shadowBlur = height * 0.1
  ctx.fillStyle = GOLD_BRIGHT
  ctx.font = `700 ${height * 0.34}px ${TOPPER_FONT}`
  ctx.fillText('SLOTS', width / 2, height * 0.36)
  ctx.font = `700 ${height * 0.34}px ${TOPPER_FONT}`
  ctx.fillText('ROYALE', width / 2, height * 0.7)
  ctx.restore()
}

function paintButtonLabel(ctx: CanvasRenderingContext2D, size: number, lines: readonly string[], color: string): void {
  ctx.clearRect(0, 0, size, size)
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color
  ctx.font = `700 ${size * 0.2}px ${DISPLAY_FONT}`
  const lineHeight = size * 0.24
  const startY = size / 2 - ((lines.length - 1) * lineHeight) / 2
  lines.forEach((line, i) => ctx.fillText(line, size / 2, startY + i * lineHeight))
  ctx.restore()
}

function paintPaylineTab(ctx: CanvasRenderingContext2D, size: number, n: number): void {
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = BRASS
  ctx.beginPath()
  ctx.roundRect(size * 0.06, size * 0.06, size * 0.88, size * 0.88, size * 0.14)
  ctx.fill()
  ctx.strokeStyle = 'rgba(20, 12, 4, 0.55)'
  ctx.lineWidth = size * 0.035
  ctx.stroke()
  ctx.fillStyle = '#241505'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${size * 0.5}px ${DISPLAY_FONT}`
  ctx.fillText(String(n), size / 2, size * 0.55)
}

function paintGlassGlare(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.clearRect(0, 0, size, size)
  const bandAngle = (35 * Math.PI) / 180
  const normalAngle = bandAngle + Math.PI / 2
  const nx = Math.cos(normalAngle)
  const ny = Math.sin(normalAngle)
  const cx = size / 2
  const cy = size / 2
  function paintBand(offset: number, halfSpan: number, peakAlpha: number): void {
    const ox = cx + nx * offset
    const oy = cy + ny * offset
    const gradient = ctx.createLinearGradient(ox - nx * halfSpan, oy - ny * halfSpan, ox + nx * halfSpan, oy + ny * halfSpan)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)')
    gradient.addColorStop(0.5, `rgba(255, 255, 255, ${peakAlpha})`)
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }
  paintBand(0, size * 0.11, 0.16)
  paintBand(size * 0.2, size * 0.06, 0.07)
  const radial = ctx.createRadialGradient(size * 0.15, size * 0.15, 0, size * 0.15, size * 0.15, size * 0.45)
  radial.addColorStop(0, 'rgba(255, 255, 255, 0.08)')
  radial.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = radial
  ctx.fillRect(0, 0, size, size)
}

function paintGlassVignette(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.clearRect(0, 0, size, size)
  const center = size / 2
  const maxRadius = size * Math.SQRT1_2
  const radial = ctx.createRadialGradient(center, center, maxRadius * 0.55, center, center, maxRadius)
  radial.addColorStop(0, 'rgba(0, 0, 0, 0)')
  radial.addColorStop(1, 'rgba(0, 0, 0, 0.4)')
  ctx.fillStyle = radial
  ctx.fillRect(0, 0, size, size)
  const edgeDepth = size * 0.08
  function paintEdge(gx0: number, gy0: number, gx1: number, gy1: number, rx: number, ry: number, rw: number, rh: number): void {
    const gradient = ctx.createLinearGradient(gx0, gy0, gx1, gy1)
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.35)')
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(rx, ry, rw, rh)
  }
  paintEdge(0, 0, 0, edgeDepth, 0, 0, size, edgeDepth)
  paintEdge(0, size, 0, size - edgeDepth, 0, size - edgeDepth, size, edgeDepth)
  paintEdge(0, 0, edgeDepth, 0, 0, 0, edgeDepth, size)
  paintEdge(size, 0, size - edgeDepth, 0, size - edgeDepth, 0, edgeDepth, size)
}

function paintSweepBand(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height)
  const gradient = ctx.createLinearGradient(0, 0, width, 0)
  gradient.addColorStop(0, 'rgba(255, 240, 200, 0)')
  gradient.addColorStop(0.5, 'rgba(255, 240, 200, 0.6)')
  gradient.addColorStop(1, 'rgba(255, 240, 200, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
}

// -------------------------------------------------------------------------------------------

export function createMachineView(): MachineView {
  const disposables: Disposable[] = []
  function own<T extends Disposable>(item: T): T {
    disposables.push(item)
    return item
  }
  function ownGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    disposables.push({ dispose: () => geometry.dispose() })
    return geometry
  }

  const group = new THREE.Group()

  // --- Shared materials -------------------------------------------------------------------
  const scratchRoughness = own(makeScratchRoughness())
  const cabinetMaterial = own(
    new THREE.MeshPhysicalMaterial({
      color: BLACK_LACQUER, roughness: 0.38, metalness: 0.3, roughnessMap: scratchRoughness, clearcoat: 1, clearcoatRoughness: 0.07,
    }),
  )
  const brushedRoughness = own(makeBrushedMetalRoughness())
  const brushedBump = own(makeBrushedMetalBump())
  const brushedMetalMaterial = own(
    new THREE.MeshStandardMaterial({
      color: '#b7bcc2', metalness: 1, roughness: 0.4, roughnessMap: brushedRoughness, bumpMap: brushedBump, bumpScale: 0.02,
    }),
  )
  const goldMaterial = own(new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.3 }))
  const maskMaterial = own(new THREE.MeshStandardMaterial({ color: MASK_BLACK, roughness: 0.85, metalness: 0.05 }))
  const glassMaterial = own(
    new THREE.MeshPhysicalMaterial({
      color: '#f2f8ff', roughness: 0.03, metalness: 0, transmission: 0.92, thickness: 0.3, ior: 1.5,
      clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4, transparent: true, depthWrite: false,
    }),
  )
  const chromeMaterial = own(new THREE.MeshStandardMaterial({ color: CHROME, metalness: 1, roughness: 0.12 }))
  // Satin chrome for the deck button bezels: the spotlight lands on them head-on, and mirror chrome blooms into halos.
  const satinChromeMaterial = own(new THREE.MeshStandardMaterial({ color: CHROME, metalness: 1, roughness: 0.32 }))
  const brassMaterial = own(new THREE.MeshStandardMaterial({ color: BRASS, metalness: 0.9, roughness: 0.28 }))
  const burgundyLacquerMaterial = own(
    new THREE.MeshPhysicalMaterial({ color: BURGUNDY_LACQUER, roughness: 0.25, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.15 }),
  )

  function addBox(
    width: number, height: number, depth: number, x: number, y: number, z: number,
    material: THREE.Material, options?: { shadow?: boolean },
  ): THREE.Mesh {
    const geometry = ownGeometry(new THREE.BoxGeometry(width, height, depth))
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    if (options?.shadow !== false) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
    group.add(mesh)
    return mesh
  }

  // --- Cabinet shell: a picture frame of four boxes, leaving the window opening clear -----
  addBox(CABINET_WIDTH, WIN_BOTTOM, CABINET_DEPTH, 0, WIN_BOTTOM / 2, CABINET_CENTER_Z, cabinetMaterial)
  addBox(CABINET_WIDTH, CABINET_HEIGHT - WIN_TOP, CABINET_DEPTH, 0, (WIN_TOP + CABINET_HEIGHT) / 2, CABINET_CENTER_Z, cabinetMaterial)
  const leftPillarWidth = WIN_LEFT - CABINET_MIN_X
  const leftPillarX = (CABINET_MIN_X + WIN_LEFT) / 2
  addBox(leftPillarWidth, WIN_TOP - WIN_BOTTOM, CABINET_DEPTH, leftPillarX, REEL_WINDOW_Y, CABINET_CENTER_Z, cabinetMaterial)
  const rightPillarWidth = CABINET_MAX_X - WIN_RIGHT
  const rightPillarX = (WIN_RIGHT + CABINET_MAX_X) / 2
  addBox(rightPillarWidth, WIN_TOP - WIN_BOTTOM, CABINET_DEPTH, rightPillarX, REEL_WINDOW_Y, CABINET_CENTER_Z, cabinetMaterial)

  // --- Brushed-metal side trims, proud of the front face along both outer edges -----------
  addBox(2, CABINET_HEIGHT, 0.3, CABINET_MIN_X + 1, CABINET_HEIGHT / 2, CABINET_MAX_Z + 0.05, brushedMetalMaterial)
  addBox(2, CABINET_HEIGHT, 0.3, CABINET_MAX_X - 1, CABINET_HEIGHT / 2, CABINET_MAX_Z + 0.05, brushedMetalMaterial)

  // --- LED accent strips on both side faces, near the front edge: tinted to match the topper's
  // current colour each frame (see `update`), so the cabinet reads as part of the light show. ---
  const ledStripMaterial = own(
    new THREE.MeshStandardMaterial({ color: GOLD_BRIGHT, emissive: GOLD_BRIGHT, emissiveIntensity: 1.2, roughness: 0.4 }),
  )
  addBox(0.1, CABINET_HEIGHT - 4, 0.45, CABINET_MAX_X + 0.05, CABINET_HEIGHT / 2, CABINET_MAX_Z - 1.2, ledStripMaterial, { shadow: false })
  addBox(0.1, CABINET_HEIGHT - 4, 0.45, -(CABINET_MAX_X + 0.05), CABINET_HEIGHT / 2, CABINET_MAX_Z - 1.2, ledStripMaterial, { shadow: false })

  // --- Gold pinstripes on the front face: two verticals near the outer edges, one horizontal
  // along the top, so the burgundy lacquer reads as a high-roller cabinet, not a black box. ---
  const pinstripeZ = CABINET_MAX_Z + PINSTRIPE_PROUD / 2
  addBox(PINSTRIPE_WIDTH, CABINET_HEIGHT - 6, PINSTRIPE_PROUD, CABINET_MAX_X - PINSTRIPE_INSET, CABINET_HEIGHT / 2, pinstripeZ, goldMaterial, { shadow: false })
  addBox(PINSTRIPE_WIDTH, CABINET_HEIGHT - 6, PINSTRIPE_PROUD, -(CABINET_MAX_X - PINSTRIPE_INSET), CABINET_HEIGHT / 2, pinstripeZ, goldMaterial, { shadow: false })
  addBox(CABINET_WIDTH - PINSTRIPE_INSET * 2, PINSTRIPE_WIDTH, PINSTRIPE_PROUD, 0, CABINET_HEIGHT - 3, pinstripeZ, goldMaterial, { shadow: false })

  // --- Gold bezel around the window, proud of the front face -------------------------------
  const bezelZ = CABINET_MAX_Z + BEZEL_DEPTH / 2
  addBox(REEL_WINDOW_WIDTH + BEZEL_WIDTH * 2, BEZEL_WIDTH, BEZEL_DEPTH, 0, WIN_TOP + BEZEL_WIDTH / 2, bezelZ, goldMaterial)
  addBox(REEL_WINDOW_WIDTH + BEZEL_WIDTH * 2, BEZEL_WIDTH, BEZEL_DEPTH, 0, WIN_BOTTOM - BEZEL_WIDTH / 2, bezelZ, goldMaterial)
  addBox(BEZEL_WIDTH, REEL_WINDOW_HEIGHT + BEZEL_WIDTH * 2, BEZEL_DEPTH, WIN_LEFT - BEZEL_WIDTH / 2, REEL_WINDOW_Y, bezelZ, goldMaterial)
  addBox(BEZEL_WIDTH, REEL_WINDOW_HEIGHT + BEZEL_WIDTH * 2, BEZEL_DEPTH, WIN_RIGHT + BEZEL_WIDTH / 2, REEL_WINDOW_Y, bezelZ, goldMaterial)

  // --- Inner chrome hairline just inside the gold bezel's inner edge ----------------------
  const bezelHairlineZ = CABINET_MAX_Z + 0.3
  addBox(REEL_WINDOW_WIDTH + BEZEL_WIDTH * 2 - 0.22, 0.22, 0.3, 0, WIN_TOP - 0.11, bezelHairlineZ, chromeMaterial, { shadow: false })
  addBox(REEL_WINDOW_WIDTH + BEZEL_WIDTH * 2 - 0.22, 0.22, 0.3, 0, WIN_BOTTOM + 0.11, bezelHairlineZ, chromeMaterial, { shadow: false })
  addBox(0.22, REEL_WINDOW_HEIGHT + BEZEL_WIDTH * 2 - 0.22, 0.3, WIN_LEFT + 0.11, REEL_WINDOW_Y, bezelHairlineZ, chromeMaterial, { shadow: false })
  addBox(0.22, REEL_WINDOW_HEIGHT + BEZEL_WIDTH * 2 - 0.22, 0.3, WIN_RIGHT - 0.11, REEL_WINDOW_Y, bezelHairlineZ, chromeMaterial, { shadow: false })

  // --- Burgundy belly panel on the lower face, below the coin tray, framed with a gold hairline --
  const bellyPanelCenterY = BELLY_PANEL_CENTER_Y
  const bellyPanelZ = CABINET_MAX_Z + BELLY_PANEL_PROUD / 2
  addBox(REEL_WINDOW_WIDTH + BEZEL_WIDTH * 2, BELLY_PANEL_HEIGHT, BELLY_PANEL_PROUD, 0, bellyPanelCenterY, bellyPanelZ, burgundyLacquerMaterial)
  {
    const frameZ = CABINET_MAX_Z + BELLY_PANEL_PROUD + PINSTRIPE_PROUD / 2
    const frameWidth = REEL_WINDOW_WIDTH + BEZEL_WIDTH * 2
    const frameTop = bellyPanelCenterY + BELLY_PANEL_HEIGHT / 2
    const frameBottom = bellyPanelCenterY - BELLY_PANEL_HEIGHT / 2
    const frameLeft = -frameWidth / 2
    const frameRight = frameWidth / 2
    addBox(frameWidth, PINSTRIPE_WIDTH, PINSTRIPE_PROUD, 0, frameTop, frameZ, goldMaterial, { shadow: false })
    addBox(frameWidth, PINSTRIPE_WIDTH, PINSTRIPE_PROUD, 0, frameBottom, frameZ, goldMaterial, { shadow: false })
    addBox(PINSTRIPE_WIDTH, BELLY_PANEL_HEIGHT, PINSTRIPE_PROUD, frameLeft, bellyPanelCenterY, frameZ, goldMaterial, { shadow: false })
    addBox(PINSTRIPE_WIDTH, BELLY_PANEL_HEIGHT, PINSTRIPE_PROUD, frameRight, bellyPanelCenterY, frameZ, goldMaterial, { shadow: false })
  }

  // --- Edge vignette, just behind the glass (in front of the reels): makes the reels read as
  // recessed behind the pane rather than sitting flush with it. ----------------------------
  {
    const geometry = ownGeometry(new THREE.PlaneGeometry(REEL_WINDOW_WIDTH, REEL_WINDOW_HEIGHT))
    const texture = own(finishTexture((() => {
      const { canvas, ctx } = makeCanvas(256, 256)
      paintGlassVignette(ctx, 256)
      return canvas
    })()))
    const material = own(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 1 }))
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(0, REEL_WINDOW_Y, REEL_WINDOW_Z + 0.6)
    mesh.renderOrder = 1
    group.add(mesh)
  }

  // --- Glass over the window --------------------------------------------------------------
  {
    const geometry = ownGeometry(new THREE.PlaneGeometry(REEL_WINDOW_WIDTH, REEL_WINDOW_HEIGHT))
    const mesh = new THREE.Mesh(geometry, glassMaterial)
    mesh.position.set(0, REEL_WINDOW_Y, CABINET_MAX_Z + 0.15)
    mesh.renderOrder = 2
    group.add(mesh)
  }

  // --- Glare streak on the glass: ceiling lights reflecting in the pane -------------------
  {
    const geometry = ownGeometry(new THREE.PlaneGeometry(REEL_WINDOW_WIDTH, REEL_WINDOW_HEIGHT))
    const texture = own(finishTexture((() => {
      const { canvas, ctx } = makeCanvas(512, 512)
      paintGlassGlare(ctx, 512)
      return canvas
    })()))
    const material = own(
      new THREE.MeshBasicMaterial({
        map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.11,
      }),
    )
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(0, REEL_WINDOW_Y, CABINET_MAX_Z + 0.2)
    mesh.renderOrder = 3
    group.add(mesh)
  }

  // --- Win sweep: a highlight band that travels across the glass on demand (see `sweepGlass`
  // below); kept narrower than the window so it never pokes past the bezel. ----------------
  const sweepWidth = REEL_WINDOW_WIDTH * 0.3
  const sweepStartX = WIN_LEFT - sweepWidth / 2
  const sweepEndX = WIN_RIGHT + sweepWidth / 2
  const sweepGeometry = ownGeometry(new THREE.PlaneGeometry(sweepWidth, REEL_WINDOW_HEIGHT))
  const sweepTexture = own(finishTexture((() => {
    const { canvas, ctx } = makeCanvas(256, 64)
    paintSweepBand(ctx, 256, 64)
    return canvas
  })()))
  const sweepMaterial = own(
    new THREE.MeshBasicMaterial({
      map: sweepTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    }),
  )
  const sweepMesh = new THREE.Mesh(sweepGeometry, sweepMaterial)
  sweepMesh.position.set(sweepStartX, REEL_WINDOW_Y, CABINET_MAX_Z + 0.25)
  sweepMesh.renderOrder = 4
  sweepMesh.visible = false
  group.add(sweepMesh)

  // --- Interior mask grille just behind the glass: divides the window into the 5x3 cell grid,
  // masking the gaps between reel cylinders and above/below the three rows. -----------------
  const maskZ = REEL_WINDOW_Z - 0.3
  for (let i = 1; i < 5; i++) {
    const x = WIN_LEFT + i * CELL_WIDTH
    addBox(0.25, REEL_WINDOW_HEIGHT, 0.3, x, REEL_WINDOW_Y, maskZ, maskMaterial, { shadow: false })
  }
  for (let i = 1; i < 3; i++) {
    const y = WIN_TOP - i * CELL_HEIGHT
    addBox(REEL_WINDOW_WIDTH, 0.25, 0.3, 0, y, maskZ, maskMaterial, { shadow: false })
  }
  // The three rows are a chord of the reel cylinder, a little shorter than the flat window: black
  // out the sliver above and below them so the neighbouring strip cells never peek through.
  const chordHalf = REEL_VISIBLE_RADIUS * Math.sin((1.5 * 2 * Math.PI) / REEL_VISIBLE_CELLS)
  const sliver = REEL_WINDOW_HEIGHT / 2 - chordHalf
  if (sliver > 0) {
    // Deep enough (reaching back to the reel surface) that a camera above or below the window
    // cannot see past the mask's inner edge onto the curve of the cylinder.
    const sliverDepth = 3
    const sliverZ = maskZ + 0.15 - sliverDepth / 2
    addBox(REEL_WINDOW_WIDTH, sliver, sliverDepth, 0, WIN_TOP - sliver / 2, sliverZ, maskMaterial, { shadow: false })
    addBox(REEL_WINDOW_WIDTH, sliver, sliverDepth, 0, WIN_BOTTOM + sliver / 2, sliverZ, maskMaterial, { shadow: false })
  }

  // --- Payline number plaques, 1-10 down the left pillar, 11-20 down the right ------------
  const tabSize = 1.15
  const tabMargin = 0.75
  const tabSpan = WIN_TOP - WIN_BOTTOM - tabMargin * 2
  const tabStep = tabSpan / (PAYLINE_TABS_PER_SIDE - 1)
  const tabGeometry = ownGeometry(new THREE.PlaneGeometry(tabSize, tabSize))
  const paylineTabMaterials: THREE.MeshStandardMaterial[] = []
  for (let line = 0; line < 20; line++) {
    const side = line < PAYLINE_TABS_PER_SIDE ? -1 : 1
    const indexOnSide = line < PAYLINE_TABS_PER_SIDE ? line : line - PAYLINE_TABS_PER_SIDE
    const texture = own(finishTexture((() => {
      const { canvas, ctx } = makeCanvas(128, 128)
      paintPaylineTab(ctx, 128, line + 1)
      return canvas
    })()))
    const material = own(
      new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.5 }),
    )
    paylineTabMaterials.push(material)
    const mesh = new THREE.Mesh(tabGeometry, material)
    const x = side < 0 ? leftPillarX : rightPillarX
    const y = WIN_TOP - tabMargin - indexOnSide * tabStep
    mesh.position.set(x, y, CABINET_MAX_Z + 0.06)
    group.add(mesh)
  }

  // --- Topper: backlit sign, chasing bulb border, beacon dome -----------------------------
  const topperGroup = new THREE.Group()
  topperGroup.position.set(0, TOPPER_Y, CABINET_CENTER_Z)
  group.add(topperGroup)

  const topperHousingMaterial = own(new THREE.MeshPhysicalMaterial({ color: BLACK_LACQUER, roughness: 0.28, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.2 }))
  {
    const geometry = ownGeometry(new THREE.BoxGeometry(TOPPER_WIDTH, TOPPER_HEIGHT, TOPPER_DEPTH))
    const mesh = new THREE.Mesh(geometry, topperHousingMaterial)
    mesh.castShadow = true
    mesh.receiveShadow = true
    topperGroup.add(mesh)
  }
  {
    const geometry = ownGeometry(new THREE.BoxGeometry(TOPPER_WIDTH + BEZEL_WIDTH, TOPPER_HEIGHT + BEZEL_WIDTH, 0.5))
    const mesh = new THREE.Mesh(geometry, goldMaterial)
    mesh.position.set(0, 0, -TOPPER_DEPTH / 2 + 0.2)
    topperGroup.add(mesh)
  }

  const signWidth = TOPPER_WIDTH - 3
  const signHeight = TOPPER_HEIGHT * 0.62
  const signCanvas = makeCanvas(1024, Math.round((signHeight / signWidth) * 1024))
  paintTopperSign(signCanvas.ctx, signCanvas.canvas.width, signCanvas.canvas.height)
  const signTexture = own(finishTexture(signCanvas.canvas))
  const signMaterial = own(
    new THREE.MeshStandardMaterial({ map: signTexture, emissiveMap: signTexture, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.5 }),
  )
  {
    const geometry = ownGeometry(new THREE.PlaneGeometry(signWidth, signHeight))
    const mesh = new THREE.Mesh(geometry, signMaterial)
    mesh.position.set(0, 0, TOPPER_DEPTH / 2 + 0.03)
    topperGroup.add(mesh)
  }

  // Marquee bulbs: walk the topper's perimeter, splitting bulbs into 3 chase groups.
  const bulbGeometry = ownGeometry(new THREE.SphereGeometry(0.4, 8, 6))
  const bulbMaterials = [0, 1, 2].map(() => own(new THREE.MeshStandardMaterial({ color: GOLD_BRIGHT, emissive: GOLD_BRIGHT, emissiveIntensity: 1 })))
  const perimeter = 2 * (TOPPER_WIDTH + TOPPER_HEIGHT)
  const bulbCount = Math.round(perimeter / 2.6)
  const bulbCounts = [0, 0, 0]
  for (let i = 0; i < bulbCount; i++) bulbCounts[i % 3] = (bulbCounts[i % 3] ?? 0) + 1
  const bulbMeshes = bulbMaterials.map((m, i) => own(new THREE.InstancedMesh(bulbGeometry, m, Math.max(1, bulbCounts[i] ?? 1))))
  const bulbSlot = [0, 0, 0]
  const bulbDummy = new THREE.Object3D()
  const halfW = TOPPER_WIDTH / 2
  const halfH = TOPPER_HEIGHT / 2
  for (let i = 0; i < bulbCount; i++) {
    const t = i / bulbCount
    const d = t * perimeter
    let localX: number
    let localY: number
    if (d < TOPPER_WIDTH) {
      localX = -halfW + d
      localY = -halfH
    } else if (d < TOPPER_WIDTH + TOPPER_HEIGHT) {
      localX = halfW
      localY = -halfH + (d - TOPPER_WIDTH)
    } else if (d < TOPPER_WIDTH * 2 + TOPPER_HEIGHT) {
      localX = halfW - (d - TOPPER_WIDTH - TOPPER_HEIGHT)
      localY = halfH
    } else {
      localX = -halfW
      localY = halfH - (d - TOPPER_WIDTH * 2 - TOPPER_HEIGHT)
    }
    bulbDummy.position.set(localX, localY, TOPPER_DEPTH / 2 + 0.35)
    bulbDummy.rotation.set(0, 0, 0)
    bulbDummy.updateMatrix()
    const g = i % 3
    const mesh = bulbMeshes[g]
    if (mesh) {
      mesh.setMatrixAt(bulbSlot[g] ?? 0, bulbDummy.matrix)
      bulbSlot[g] = (bulbSlot[g] ?? 0) + 1
    }
  }
  bulbMeshes.forEach((m) => {
    m.instanceMatrix.needsUpdate = true
    m.castShadow = false
    m.receiveShadow = false
    topperGroup.add(m)
  })

  // Win lamp: a red beacon dome on top of the topper, with a small rotating sweep.
  const winLampMaterial = own(new THREE.MeshStandardMaterial({ color: '#8a1420', emissive: '#c81f2f', emissiveIntensity: 0.15, roughness: 0.3, metalness: 0.1 }))
  const winLampGroup = new THREE.Group()
  winLampGroup.position.set(0, halfH + 1.1, 0)
  topperGroup.add(winLampGroup)
  {
    const geometry = ownGeometry(new THREE.SphereGeometry(1.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2))
    const mesh = new THREE.Mesh(geometry, winLampMaterial)
    winLampGroup.add(mesh)
  }
  const winLampSweepMaterial = own(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.2, transparent: true, opacity: 0.6 }))
  const winLampSweep = new THREE.Mesh(ownGeometry(new THREE.BoxGeometry(1.6, 0.15, 0.15)), winLampSweepMaterial)
  winLampSweep.position.y = 0.5
  winLampSweep.castShadow = false
  winLampSweep.receiveShadow = false
  winLampGroup.add(winLampSweep)

  // --- Button deck: a sloped panel toward the player ---------------------------------------
  const deckGroup = new THREE.Group()
  deckGroup.position.set(0, DECK_Y, DECK_Z)
  deckGroup.rotation.x = DECK_ANGLE
  group.add(deckGroup)

  function addDeckBox(width: number, height: number, depth: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
    const geometry = ownGeometry(new THREE.BoxGeometry(width, height, depth))
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    deckGroup.add(mesh)
    return mesh
  }

  // Black pebbled leatherette bump, shared by the deck panel and the padded armrest.
  const deckPebbleBump = own(makePebbleBump())
  deckPebbleBump.wrapS = THREE.RepeatWrapping
  deckPebbleBump.wrapT = THREE.RepeatWrapping
  deckPebbleBump.repeat.set(3, 1.6)
  const deckPanelMaterial = own(
    new THREE.MeshPhysicalMaterial({
      color: '#0b090a', roughness: 0.8, metalness: 0, specularIntensity: 0.25, sheen: 0.4, sheenRoughness: 0.6, sheenColor: '#3a3236', bumpMap: deckPebbleBump, bumpScale: 0.02,
    }),
  )
  {
    const geometry = ownGeometry(new THREE.BoxGeometry(DECK_WIDTH, DECK_PANEL_HEIGHT, 1.4))
    const mesh = new THREE.Mesh(geometry, deckPanelMaterial)
    mesh.castShadow = true
    mesh.receiveShadow = true
    deckGroup.add(mesh)
  }

  // Brushed-steel frame around the deck face, proud of it along all four edges.
  {
    const deckFrameZ = 0.7 + 0.125
    const deckFrameThickness = 0.7
    const deckFrameProud = 0.25
    addDeckBox(DECK_WIDTH, deckFrameThickness, deckFrameProud, 0, DECK_PANEL_HEIGHT / 2, deckFrameZ, brushedMetalMaterial)
    addDeckBox(DECK_WIDTH, deckFrameThickness, deckFrameProud, 0, -DECK_PANEL_HEIGHT / 2, deckFrameZ, brushedMetalMaterial)
    addDeckBox(deckFrameThickness, DECK_PANEL_HEIGHT, deckFrameProud, DECK_WIDTH / 2, 0, deckFrameZ, brushedMetalMaterial)
    addDeckBox(deckFrameThickness, DECK_PANEL_HEIGHT, deckFrameProud, -DECK_WIDTH / 2, 0, deckFrameZ, brushedMetalMaterial)
  }

  // Padded armrest along the player edge.
  const armrestMaterial = own(
    new THREE.MeshPhysicalMaterial({
      color: '#0f0c0d', roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.35, bumpMap: deckPebbleBump, bumpScale: 0.02,
    }),
  )
  {
    const geometry = ownGeometry(new THREE.CapsuleGeometry(1.1, DECK_WIDTH - 1.2, 6, 20))
    const mesh = new THREE.Mesh(geometry, armrestMaterial)
    mesh.rotation.z = Math.PI / 2
    mesh.position.set(0, -DECK_PANEL_HEIGHT / 2 - 0.9, 0.2)
    mesh.castShadow = true
    mesh.receiveShadow = true
    deckGroup.add(mesh)
  }

  // Cap materials: MeshPhysicalMaterial for a glossy, clearcoated dome; `setButtonLit` only ever
  // touches spin/bet/max (the auto cap's glow is fixed, see below).
  const buttonMaterials: Record<'spin' | 'bet' | 'max', THREE.MeshPhysicalMaterial> = {
    spin: own(new THREE.MeshPhysicalMaterial({ color: RED_BUTTON, emissive: RED_BUTTON, emissiveIntensity: 0.28, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 })),
    bet: own(new THREE.MeshPhysicalMaterial({ color: AMBER_BUTTON, emissive: AMBER_BUTTON_EMISSIVE, emissiveIntensity: 0.25, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 })),
    max: own(new THREE.MeshPhysicalMaterial({ color: AMBER_BUTTON, emissive: AMBER_BUTTON_EMISSIVE, emissiveIntensity: 0.25, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 })),
  }
  const autoButtonMaterial = own(
    new THREE.MeshPhysicalMaterial({
      color: VIOLET_BUTTON, emissive: VIOLET_BUTTON_EMISSIVE, emissiveIntensity: 0.25, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06,
    }),
  )

  function makeCapLabelMaterial(lines: readonly string[], color: string, size = 256): THREE.MeshStandardMaterial {
    const { canvas, ctx } = makeCanvas(size, size)
    paintButtonLabel(ctx, size, lines, color)
    const texture = own(finishTexture(canvas))
    return own(
      new THREE.MeshStandardMaterial({
        map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.55,
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, roughness: 0.3,
      }),
    )
  }

  /** Chrome bezel + illuminated dome cap + printed label, built around the local y axis; the
   *  caller's group rotation (`rotation.x = Math.PI / 2`) points that axis straight out of the
   *  deck face. Replaces the old `addRoundButton`, whose label always faced into the cylinder. */
  function addArcadeButton(
    x: number, y: number, radius: number, capMaterial: THREE.MeshPhysicalMaterial,
    labelLines: readonly string[], labelColor: string, name: 'spin' | 'bet' | 'max' | 'auto',
  ): THREE.Group {
    const buttonGroup = new THREE.Group()
    buttonGroup.position.set(x, y, 0.7)
    buttonGroup.rotation.x = Math.PI / 2
    deckGroup.add(buttonGroup)

    const bezelPoints = [
      new THREE.Vector2(radius + 0.02, 0),
      new THREE.Vector2(radius + 0.55, 0),
      new THREE.Vector2(radius + 0.62, 0.12),
      new THREE.Vector2(radius + 0.55, 0.3),
      new THREE.Vector2(radius + 0.3, 0.38),
      new THREE.Vector2(radius + 0.06, 0.3),
      new THREE.Vector2(radius + 0.02, 0.05),
    ]
    const bezel = new THREE.Mesh(ownGeometry(new THREE.LatheGeometry(bezelPoints, 40)), satinChromeMaterial)
    bezel.castShadow = true
    bezel.receiveShadow = true
    buttonGroup.add(bezel)

    const well = new THREE.Mesh(ownGeometry(new THREE.CircleGeometry(radius + 0.05, 40)), maskMaterial)
    well.rotation.x = -Math.PI / 2
    well.position.y = 0.02
    buttonGroup.add(well)

    // Dome: a short vertical skirt at the base, then 8 points along an elliptical arc up to the crown.
    const domeHeight = radius * 0.3
    const domeSamples = 8
    const capPoints: THREE.Vector2[] = [new THREE.Vector2(radius, 0), new THREE.Vector2(radius, 0.1)]
    for (let i = 0; i <= domeSamples; i++) {
      const t = (i / domeSamples) * (Math.PI / 2)
      capPoints.push(new THREE.Vector2(radius * Math.cos(t), 0.1 + domeHeight * Math.sin(t)))
    }
    const capGeometry = ownGeometry(new THREE.LatheGeometry(capPoints, 40))
    const cap = new THREE.Mesh(capGeometry, capMaterial)
    cap.name = name
    cap.userData.button = name
    cap.castShadow = true
    buttonGroup.add(cap)

    // Label: a slightly enlarged copy of the cap geometry with planar UVs from local x/z, so the
    // printed texture reads from directly outside the dome; raycast disabled so picks hit the cap.
    const labelGeometry = ownGeometry(capGeometry.clone())
    labelGeometry.scale(1.004, 1.004, 1.004)
    const position = labelGeometry.attributes.position
    const uv = new Float32Array(position.count * 2)
    for (let i = 0; i < position.count; i++) {
      const px = position.getX(i)
      const pz = position.getZ(i)
      uv[i * 2] = px / (2 * radius) + 0.5
      uv[i * 2 + 1] = 0.5 - pz / (2 * radius)
    }
    labelGeometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    const label = new THREE.Mesh(labelGeometry, makeCapLabelMaterial(labelLines, labelColor))
    label.raycast = () => {}
    buttonGroup.add(label)

    return buttonGroup
  }

  addArcadeButton(7, -1.5, 3.4, buttonMaterials.spin, ['SPIN'], '#fff1d6', 'spin')
  addArcadeButton(-9.5, 2, 1.5, buttonMaterials.bet, ['BET'], '#2a1606', 'bet')
  addArcadeButton(-5.5, 2, 1.5, buttonMaterials.max, ['MAX', 'BET'], '#2a1606', 'max')
  addArcadeButton(-1.5, 2, 1.5, autoButtonMaterial, ['AUTO'], '#f4eaff', 'auto')

  // Coin slot and bill acceptor.
  addBox(3.2, 0.5, 0.5, -9.5, -3.6, 0.95, maskMaterial, { shadow: false })
  {
    const acceptor = addBox(4.5, 2.4, 0.6, -3, -3.4, 0.9, own(new THREE.MeshStandardMaterial({ color: '#0d0d10', roughness: 0.5, metalness: 0.3 })))
    acceptor.castShadow = true
    const ledMaterial = own(new THREE.MeshStandardMaterial({ color: GREEN_LED, emissive: GREEN_LED, emissiveIntensity: 0.9 }))
    const led = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(0.5, 0.25)), ledMaterial)
    led.position.set(1.7, 0.9, 0.32)
    acceptor.add(led)

    // Chrome bezel and smoked-glass mouth around the acceptor slot.
    const acceptorBezelThickness = 0.2
    const acceptorBezelWidth = 5
    const acceptorBezelHeight = 2.9
    const acceptorBezelZ = 0.32
    const bezelTop = new THREE.Mesh(ownGeometry(new THREE.BoxGeometry(acceptorBezelWidth, acceptorBezelThickness, acceptorBezelThickness)), chromeMaterial)
    bezelTop.position.set(0, acceptorBezelHeight / 2 - acceptorBezelThickness / 2, acceptorBezelZ)
    acceptor.add(bezelTop)
    const bezelBottom = new THREE.Mesh(ownGeometry(new THREE.BoxGeometry(acceptorBezelWidth, acceptorBezelThickness, acceptorBezelThickness)), chromeMaterial)
    bezelBottom.position.set(0, -(acceptorBezelHeight / 2 - acceptorBezelThickness / 2), acceptorBezelZ)
    acceptor.add(bezelBottom)
    const bezelLeft = new THREE.Mesh(ownGeometry(new THREE.BoxGeometry(acceptorBezelThickness, acceptorBezelHeight, acceptorBezelThickness)), chromeMaterial)
    bezelLeft.position.set(-(acceptorBezelWidth / 2 - acceptorBezelThickness / 2), 0, acceptorBezelZ)
    acceptor.add(bezelLeft)
    const bezelRight = new THREE.Mesh(ownGeometry(new THREE.BoxGeometry(acceptorBezelThickness, acceptorBezelHeight, acceptorBezelThickness)), chromeMaterial)
    bezelRight.position.set(acceptorBezelWidth / 2 - acceptorBezelThickness / 2, 0, acceptorBezelZ)
    acceptor.add(bezelRight)
    const glassMouthMaterial = own(new THREE.MeshPhysicalMaterial({ color: '#0a0a0c', roughness: 0.1, clearcoat: 1 }))
    const glassMouth = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(3.6, 0.5)), glassMouthMaterial)
    glassMouth.position.set(0, 0, acceptorBezelZ)
    acceptor.add(glassMouth)
  }

  // --- Coin tray and kick plate -------------------------------------------------------------
  {
    const trayOuter = ownGeometry(new THREE.BoxGeometry(CABINET_WIDTH * 0.6, 3, 6))
    const tray = new THREE.Mesh(trayOuter, chromeMaterial)
    tray.position.set(0, TRAY_Y, CABINET_MAX_Z + 4)
    tray.castShadow = true
    tray.receiveShadow = true
    group.add(tray)
    const troughMaterial = own(new THREE.MeshStandardMaterial({ color: '#1c1c1f', metalness: 0.6, roughness: 0.6 }))
    const trough = new THREE.Mesh(ownGeometry(new THREE.BoxGeometry(CABINET_WIDTH * 0.6 - 1, 0.4, 5)), troughMaterial)
    trough.position.set(0, TRAY_Y + 1.3, CABINET_MAX_Z + 4)
    group.add(trough)
    // Rounded chrome lip along the tray's top front edge.
    const trayLip = new THREE.Mesh(ownGeometry(new THREE.CapsuleGeometry(0.45, CABINET_WIDTH * 0.6 - 1, 4, 16)), chromeMaterial)
    trayLip.rotation.z = Math.PI / 2
    trayLip.position.set(0, TRAY_Y + 1.5, CABINET_MAX_Z + 7)
    trayLip.castShadow = true
    trayLip.receiveShadow = true
    group.add(trayLip)
  }
  addBox(CABINET_WIDTH, 4, 1, 0, 2, CABINET_MAX_Z + 0.5, brassMaterial)

  // --- Lever: bracket, rod, red ball knob ---------------------------------------------------
  const leverPivot = new THREE.Group()
  leverPivot.position.set(LEVER_X, LEVER_Y - 9, CABINET_CENTER_Z)
  group.add(leverPivot)
  {
    const bracket = new THREE.Mesh(ownGeometry(new THREE.BoxGeometry(2, 2, 3)), chromeMaterial)
    bracket.castShadow = true
    bracket.receiveShadow = true
    leverPivot.add(bracket)
  }
  const leverRodLength = 16
  const leverRod = new THREE.Mesh(ownGeometry(new THREE.CylinderGeometry(0.45, 0.45, leverRodLength, 12)), chromeMaterial)
  leverRod.position.set(0, leverRodLength / 2, 0)
  leverRod.castShadow = true
  leverRod.receiveShadow = true
  leverPivot.add(leverRod)
  const leverKnobMaterial = own(new THREE.MeshStandardMaterial({ color: RED_BUTTON, roughness: 0.3, metalness: 0.1 }))
  const leverKnob = new THREE.Mesh(ownGeometry(new THREE.SphereGeometry(1.6, 16, 12)), leverKnobMaterial)
  leverKnob.position.set(0, leverRodLength, 0)
  leverKnob.name = 'lever'
  leverKnob.userData.button = 'lever'
  leverKnob.castShadow = true
  leverKnob.receiveShadow = true
  leverPivot.add(leverKnob)

  // --- Payline glow tubes --------------------------------------------------------------------
  const glowGroup = new THREE.Group()
  group.add(glowGroup)
  interface ActiveGlow {
    line: number
    mesh: THREE.Mesh
    geometry: THREE.BufferGeometry
    material: THREE.MeshStandardMaterial
  }
  let activeGlows: ActiveGlow[] = []

  function clearGlows(): void {
    for (const glow of activeGlows) {
      glowGroup.remove(glow.mesh)
      glow.geometry.dispose()
      glow.material.dispose()
    }
    activeGlows = []
  }

  function setPaylineGlow(active: readonly PaylineGlow[]): void {
    clearGlows()
    const litLines = new Set(active.map((a) => a.line))
    for (let line = 0; line < 20; line++) {
      const material = paylineTabMaterials[line]
      if (material) material.emissiveIntensity = litLines.has(line) ? 1.4 : 0.35
    }
    for (const entry of active) {
      const points = entry.cells.map((cell) => {
        const p = cellPosition(cell.reel, cell.row)
        return new THREE.Vector3(p.x, p.y, REEL_WINDOW_Z + 0.15)
      })
      if (points.length < 2) continue
      const curve = new THREE.CatmullRomCurve3(points)
      const geometry = new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), 0.12, 8, false)
      const color = new THREE.Color(SYMBOL_COLOR[entry.symbol])
      const material = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 1.6, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = false
      mesh.receiveShadow = false
      glowGroup.add(mesh)
      activeGlows.push({ line: entry.line, mesh, geometry, material })
    }
  }

  // --- Public control state -------------------------------------------------------------------
  let topperMode: TopperMode = 'idle'
  let leverElapsed = 0
  let leverDuration = 0
  let leverActive = false
  let winLampOn = false
  let sweepActive = false
  let sweepElapsed = 0
  let sweepDuration = 0
  const scratchColor = new THREE.Color()

  function setTopperMode(mode: TopperMode): void {
    topperMode = mode
  }

  function pullLever(seconds: number): void {
    leverDuration = Math.max(0.05, seconds)
    leverElapsed = 0
    leverActive = true
  }

  function setButtonLit(name: 'spin' | 'bet' | 'max', lit: boolean): void {
    const material = buttonMaterials[name]
    material.emissiveIntensity = name === 'spin' ? (lit ? 0.9 : 0.28) : lit ? 0.7 : 0.25
    if (name === 'spin') material.color.set(lit ? RED_BUTTON_LIT : RED_BUTTON)
  }

  function showWinLamp(on: boolean): void {
    winLampOn = on
  }

  function sweepGlass(seconds: number): void {
    sweepDuration = Math.max(0.05, seconds)
    sweepElapsed = 0
    sweepActive = true
    sweepMesh.visible = true
  }

  function topperChaseSpeed(mode: TopperMode): number {
    if (mode === 'spin') return 3.2
    if (mode === 'win') return 4
    if (mode === 'jackpot') return 5
    if (mode === 'free') return 2.4
    return 0.6
  }

  function applyTopperColor(mode: TopperMode, time: number, groupIndex: number): void {
    if (mode === 'jackpot') scratchColor.setHSL((time * 0.3 + groupIndex / 3) % 1, 0.85, 0.55)
    else if (mode === 'free') scratchColor.set('#b98cf2')
    else if (mode === 'win') scratchColor.set(Math.sin(time * 11 + groupIndex) > 0 ? '#ffffff' : GOLD_BRIGHT)
    else scratchColor.set(GOLD_BRIGHT)
  }

  function update(dt: number, time: number): void {
    // Topper marquee bulbs: three interleaved chase groups.
    const speed = topperChaseSpeed(topperMode)
    bulbMaterials.forEach((material, i) => {
      const phase = (time * speed - i / 3) % 1
      const wrapped = phase < 0 ? phase + 1 : phase
      material.emissiveIntensity = wrapped < 0.4 ? 1.7 : 0.3
      applyTopperColor(topperMode, time, i)
      material.color.copy(scratchColor)
      material.emissive.copy(scratchColor)
    })
    signMaterial.emissiveIntensity = 1.1 + Math.sin(time * 1.1) * 0.15

    // Cabinet LED strips: tinted to match the topper's own group-0 colour each frame.
    applyTopperColor(topperMode, time, 0)
    ledStripMaterial.color.copy(scratchColor)
    ledStripMaterial.emissive.copy(scratchColor)

    // Win lamp: flashes and sweeps while on, sits dim while off.
    if (winLampOn) {
      winLampMaterial.emissiveIntensity = 1.1 + 0.9 * Math.sin(time * 10)
      winLampSweep.rotation.y = time * 6
      winLampSweepMaterial.opacity = 0.55 + 0.35 * Math.sin(time * 10)
    } else {
      winLampMaterial.emissiveIntensity = 0.15
      winLampSweepMaterial.opacity = 0.15
    }

    // Lever: pull down with an ease, then spring back with a damped overshoot.
    if (leverActive) {
      leverElapsed += dt
      const phase = clamp01(leverElapsed / leverDuration)
      let angle: number
      if (phase < 0.4) {
        angle = LEVER_PULL_ANGLE * easeOutCubic(phase / 0.4)
      } else {
        const t = (phase - 0.4) / 0.6
        angle = LEVER_PULL_ANGLE * (1 - t) + LEVER_PULL_ANGLE * 0.18 * Math.sin(t * Math.PI * 3) * (1 - t)
      }
      leverPivot.rotation.z = -angle
      if (phase >= 1) {
        leverActive = false
        leverPivot.rotation.z = 0
      }
    }

    // Payline glow tubes pulse gently while shown.
    activeGlows.forEach((glow, i) => {
      glow.material.emissiveIntensity = 1.3 + 0.5 * Math.sin(time * 6 + i)
    })

    // Win sweep: a highlight band travels across the glass once, then hides.
    if (sweepActive) {
      sweepElapsed += dt
      const sweepT = clamp01(sweepElapsed / sweepDuration)
      const eased = easeOutCubic(sweepT)
      sweepMesh.position.x = sweepStartX + (sweepEndX - sweepStartX) * eased
      sweepMaterial.opacity = 0.7 * Math.sin(Math.PI * sweepT)
      if (sweepT >= 1) {
        sweepActive = false
        sweepMesh.visible = false
      }
    }
  }

  function dispose(): void {
    clearGlows()
    for (const item of disposables) item.dispose()
    disposables.length = 0
  }

  return { group, setTopperMode, pullLever, setPaylineGlow, setButtonLit, showWinLamp, sweepGlass, update, dispose }
}
