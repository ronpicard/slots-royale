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
 * SPIN button's cylinder, the BET button's cylinder, the MAX BET button's cylinder, the AUTO
 * button's cylinder, and the lever's ball knob each carry `mesh.name` ('spin' / 'bet' / 'max' /
 * 'auto' / 'lever') and `mesh.userData.button` set to the same string, so a raycast intersection's
 * `object.userData.button` names the control to act on regardless of which mesh in the hierarchy
 * was hit.
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
const BURGUNDY = '#2c0b12'
const BRASS = '#c9a54a'
const CHROME = '#d8dade'
const RED_BUTTON = '#c81f2f'
const RED_BUTTON_LIT = '#ff3b4d'
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

// -------------------------------------------------------------------------------------------
// Canvas texture painters
// -------------------------------------------------------------------------------------------

function paintTopperSign(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height)
  const bg = ctx.createLinearGradient(0, 0, 0, height)
  bg.addColorStop(0, BURGUNDY_DEEP)
  bg.addColorStop(1, BURGUNDY)
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
    new THREE.MeshStandardMaterial({ color: BLACK_LACQUER, roughness: 0.3, metalness: 0.2, roughnessMap: scratchRoughness }),
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
      color: '#eef6ff', roughness: 0.05, metalness: 0, transmission: 0.9, thickness: 0.2, transparent: true, ior: 1.5,
    }),
  )
  const chromeMaterial = own(new THREE.MeshStandardMaterial({ color: CHROME, metalness: 1, roughness: 0.15 }))
  const brassMaterial = own(new THREE.MeshStandardMaterial({ color: BRASS, metalness: 0.9, roughness: 0.3 }))
  const pebbleBump = own(makePebbleBump())

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

  // --- Gold bezel around the window, proud of the front face -------------------------------
  const bezelZ = CABINET_MAX_Z + BEZEL_DEPTH / 2
  addBox(REEL_WINDOW_WIDTH + BEZEL_WIDTH * 2, BEZEL_WIDTH, BEZEL_DEPTH, 0, WIN_TOP + BEZEL_WIDTH / 2, bezelZ, goldMaterial)
  addBox(REEL_WINDOW_WIDTH + BEZEL_WIDTH * 2, BEZEL_WIDTH, BEZEL_DEPTH, 0, WIN_BOTTOM - BEZEL_WIDTH / 2, bezelZ, goldMaterial)
  addBox(BEZEL_WIDTH, REEL_WINDOW_HEIGHT + BEZEL_WIDTH * 2, BEZEL_DEPTH, WIN_LEFT - BEZEL_WIDTH / 2, REEL_WINDOW_Y, bezelZ, goldMaterial)
  addBox(BEZEL_WIDTH, REEL_WINDOW_HEIGHT + BEZEL_WIDTH * 2, BEZEL_DEPTH, WIN_RIGHT + BEZEL_WIDTH / 2, REEL_WINDOW_Y, bezelZ, goldMaterial)

  // --- Glass over the window --------------------------------------------------------------
  {
    const geometry = ownGeometry(new THREE.PlaneGeometry(REEL_WINDOW_WIDTH, REEL_WINDOW_HEIGHT))
    const mesh = new THREE.Mesh(geometry, glassMaterial)
    mesh.position.set(0, REEL_WINDOW_Y, CABINET_MAX_Z + 0.05)
    group.add(mesh)
  }

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
    addBox(REEL_WINDOW_WIDTH, sliver, 0.3, 0, WIN_TOP - sliver / 2, maskZ, maskMaterial, { shadow: false })
    addBox(REEL_WINDOW_WIDTH, sliver, 0.3, 0, WIN_BOTTOM + sliver / 2, maskZ, maskMaterial, { shadow: false })
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

  const deckPanelMaterial = own(new THREE.MeshStandardMaterial({ color: '#17151a', roughness: 0.55, metalness: 0.25, bumpMap: pebbleBump, bumpScale: 0.03 }))
  {
    const geometry = ownGeometry(new THREE.BoxGeometry(DECK_WIDTH, DECK_PANEL_HEIGHT, 1.4))
    const mesh = new THREE.Mesh(geometry, deckPanelMaterial)
    mesh.castShadow = true
    mesh.receiveShadow = true
    deckGroup.add(mesh)
  }

  const buttonMaterials: Record<'spin' | 'bet' | 'max', THREE.MeshStandardMaterial> = {
    spin: own(new THREE.MeshStandardMaterial({ color: RED_BUTTON, emissive: RED_BUTTON, emissiveIntensity: 0.25, roughness: 0.35, bumpMap: pebbleBump, bumpScale: 0.02 })),
    bet: own(new THREE.MeshStandardMaterial({ color: '#141319', emissive: GOLD, emissiveIntensity: 0.15, roughness: 0.4, bumpMap: pebbleBump, bumpScale: 0.02 })),
    max: own(new THREE.MeshStandardMaterial({ color: '#141319', emissive: GOLD, emissiveIntensity: 0.15, roughness: 0.4, bumpMap: pebbleBump, bumpScale: 0.02 })),
  }
  const autoButtonMaterial = own(
    new THREE.MeshStandardMaterial({ color: '#141319', emissive: '#b98cf2', emissiveIntensity: 0.2, roughness: 0.4, bumpMap: pebbleBump, bumpScale: 0.02 }),
  )

  function makeLabelMaterial(lines: readonly string[], color: string, size = 256): THREE.MeshStandardMaterial {
    const { canvas, ctx } = makeCanvas(size, size)
    paintButtonLabel(ctx, size, lines, color)
    const texture = own(finishTexture(canvas))
    return own(new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.9, transparent: true, roughness: 0.5 }))
  }

  function addRoundButton(
    x: number, y: number, radius: number, height: number, bodyMaterial: THREE.Material, labelLines: readonly string[], labelColor: string, name?: string,
  ): THREE.Mesh {
    const geometry = ownGeometry(new THREE.CylinderGeometry(radius, radius, height, 24))
    const mesh = new THREE.Mesh(geometry, bodyMaterial)
    mesh.position.set(x, y, height / 2 + 0.72)
    mesh.rotation.x = Math.PI / 2
    mesh.castShadow = true
    mesh.receiveShadow = true
    if (name) {
      mesh.name = name
      mesh.userData.button = name
    }
    deckGroup.add(mesh)
    const labelGeometry = ownGeometry(new THREE.CircleGeometry(radius * 0.92, 24))
    const labelMesh = new THREE.Mesh(labelGeometry, makeLabelMaterial(labelLines, labelColor))
    labelMesh.position.set(0, 0, height / 2 + 0.01)
    mesh.add(labelMesh)
    return mesh
  }

  addRoundButton(7, -1.5, 3.4, 1.4, buttonMaterials.spin, ['SPIN'], '#ffe9c2', 'spin')
  addRoundButton(-9.5, 2, 1.5, 1, buttonMaterials.bet, ['BET'], GOLD_BRIGHT, 'bet')
  addRoundButton(-5.5, 2, 1.5, 1, buttonMaterials.max, ['MAX', 'BET'], GOLD_BRIGHT, 'max')
  addRoundButton(-1.5, 2, 1.5, 1, autoButtonMaterial, ['AUTO'], '#e6d4ff', 'auto')

  // Coin slot and bill acceptor.
  addBox(3.2, 0.5, 0.5, -9.5, -3.6, 0.95, maskMaterial, { shadow: false })
  {
    const acceptor = addBox(4.5, 2.4, 0.6, -3, -3.4, 0.9, own(new THREE.MeshStandardMaterial({ color: '#0d0d10', roughness: 0.5, metalness: 0.3 })))
    acceptor.castShadow = true
    const ledMaterial = own(new THREE.MeshStandardMaterial({ color: GREEN_LED, emissive: GREEN_LED, emissiveIntensity: 0.9 }))
    const led = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(0.5, 0.25)), ledMaterial)
    led.position.set(1.7, 0.9, 0.32)
    acceptor.add(led)
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
    material.emissiveIntensity = lit ? (name === 'spin' ? 0.9 : 0.6) : name === 'spin' ? 0.25 : 0.15
    material.color.set(name === 'spin' && lit ? RED_BUTTON_LIT : name === 'spin' ? RED_BUTTON : '#141319')
  }

  function showWinLamp(on: boolean): void {
    winLampOn = on
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
  }

  function dispose(): void {
    clearGlows()
    for (const item of disposables) item.dispose()
    disposables.length = 0
  }

  return { group, setTopperMode, pullLever, setPaylineGlow, setButtonLit, showWinLamp, update, dispose }
}
