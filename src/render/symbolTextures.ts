/**
 * Procedural canvas art for the ten symbols: a 256x256 icon per symbol (cached, shared by every
 * view that shows a symbol outside the reels: HUD swatches, the paytable modal) and a tall strip
 * texture per reel that stacks a strip's symbols top to bottom, for `reelView.ts` to wrap around a
 * cylinder.
 *
 * No image files or emoji: every icon is drawn with canvas paths, gradients and (for lettering)
 * `fillText`, which counts as a vector drawing primitive here, not an image asset.
 *
 * `makeReelStripTexture` draws strip index `i` at canvas row `i * cellHeight` (index 0 at the
 * canvas top, index `strip.length - 1` at the bottom) - the natural, top-to-bottom order - and
 * sets `texture.rotation = PI/2` about `center = (0.5, 0.5)` so that order reads correctly once
 * wrapped around the reel cylinder. That sign matters: three.js's UV transform
 * (`Matrix3.setUvTransform`) rotates the *sampling point* clockwise on screen for a positive
 * angle, the opposite of the naive counter-clockwise `(u - cx)*cos - (v - cy)*sin` formula, so
 * `rotation = -PI/2` (which looks right by that naive formula) actually turns every symbol 180
 * degrees. See `reelView.ts`'s header comment for the full derivation, worked through with the
 * real matrix formula, of why `PI/2` is the correct sign and how it lines up with `windowFor`.
 */

import * as THREE from 'three'
import type { SymbolId } from '../game/types.ts'

const SYMBOL_CANVAS_SIZE = 256
/** Symbol cells taller than this would push a 34-symbol strip past the 8192 canvas-height cap. */
const MAX_STRIP_FOR_FULL_CELL = 32
const TALL_CELL_HEIGHT = 256
const SHORT_CELL_HEIGHT = 200

const BACKGROUND = '#0d1224'
const GOLD = '#d4af37'
const SEVEN_RED = '#e23c4f'
const CYAN = '#6fd6e8'
const YELLOW = '#f4d03f'
const ORANGE = '#f39c12'
const PLUM = '#7b3fa0'
const WILD_PURPLE = '#b98cf2'
const SCATTER_GOLD = '#f3d27a'
const LEAF_GREEN = '#3f9142'

/** Accent colour per symbol, for HUD swatches and payline glows. */
export const SYMBOL_COLOR: Record<SymbolId, string> = {
  seven: SEVEN_RED,
  bar: GOLD,
  bell: GOLD,
  diamond: CYAN,
  cherry: SEVEN_RED,
  lemon: YELLOW,
  orange: ORANGE,
  plum: PLUM,
  wild: WILD_PURPLE,
  scatter: SCATTER_GOLD,
}

// -------------------------------------------------------------------------------------------
// Shape helpers
// -------------------------------------------------------------------------------------------

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawBackground(ctx: CanvasRenderingContext2D, size: number): void {
  const r = size * 0.12
  ctx.fillStyle = BACKGROUND
  roundRectPath(ctx, 3, 3, size - 6, size - 6, r)
  ctx.fill()
  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.62)
  vignette.addColorStop(0, 'rgba(255,255,255,0.08)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.4)')
  ctx.fillStyle = vignette
  roundRectPath(ctx, 3, 3, size - 6, size - 6, r)
  ctx.fill()
}

// -------------------------------------------------------------------------------------------
// Icons
// -------------------------------------------------------------------------------------------

function drawSeven(ctx: CanvasRenderingContext2D, size: number): void {
  const cx = size / 2
  const cy = size / 2 + size * 0.03
  ctx.save()
  ctx.font = `900 ${size * 0.62}px Georgia, 'Times New Roman', serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = size * 0.055
  ctx.strokeStyle = GOLD
  ctx.strokeText('7', cx, cy)
  ctx.fillStyle = SEVEN_RED
  ctx.fillText('7', cx, cy)
  const gloss = ctx.createLinearGradient(0, cy - size * 0.3, 0, cy + size * 0.02)
  gloss.addColorStop(0, 'rgba(255,255,255,0.55)')
  gloss.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gloss
  ctx.fillText('7', cx, cy)
  ctx.restore()
}

function drawBar(ctx: CanvasRenderingContext2D, size: number): void {
  const barHeight = size * 0.16
  const gap = size * 0.06
  const width = size * 0.62
  const x = (size - width) / 2
  const startY = size * 0.22
  ctx.save()
  ctx.lineWidth = size * 0.02
  ctx.strokeStyle = GOLD
  for (let i = 0; i < 3; i++) {
    const y = startY + i * (barHeight + gap)
    ctx.fillStyle = '#111318'
    roundRectPath(ctx, x, y, width, barHeight, barHeight * 0.25)
    ctx.fill()
    ctx.stroke()
  }
  ctx.fillStyle = GOLD
  ctx.font = `700 ${size * 0.15}px Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('BAR', size / 2, startY + (barHeight + gap) + barHeight / 2)
  ctx.restore()
}

function drawBell(ctx: CanvasRenderingContext2D, size: number): void {
  const cx = size / 2
  const cy = size * 0.42
  const r = size * 0.26
  ctx.save()
  ctx.fillStyle = GOLD
  ctx.beginPath()
  ctx.arc(cx, cy, r, Math.PI, 0, false)
  ctx.lineTo(cx + r * 1.15, cy + r * 0.9)
  ctx.quadraticCurveTo(cx, cy + r * 1.2, cx - r * 1.15, cy + r * 0.9)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(cx, cy + r * 0.92, r * 1.2, r * 0.22, 0, 0, Math.PI * 2)
  ctx.fillStyle = '#f1c869'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy + r * 1.32, r * 0.16, 0, Math.PI * 2)
  ctx.fillStyle = '#2b1d05'
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(cx - r * 0.35, cy - r * 0.1, r * 0.28, r * 0.5, -0.4, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy - r * 1.05, r * 0.18, 0, Math.PI * 2)
  ctx.fillStyle = GOLD
  ctx.fill()
  ctx.restore()
}

/** A cut gem: a wide flat-topped crown over a triangular pavilion, no boat-like hull shape. */
function drawDiamond(ctx: CanvasRenderingContext2D, size: number): void {
  const cx = size / 2
  const tableHalf = size * 0.16
  const crownHalf = size * 0.32
  const tableY = size * 0.3
  const girdleY = size * 0.48
  const pavilionTipY = size * 0.78
  ctx.save()
  ctx.strokeStyle = 'rgba(20,70,80,0.55)'
  ctx.lineWidth = size * 0.012

  // Crown: a flat-topped trapezoid (the table on top, widening down to the girdle).
  ctx.beginPath()
  ctx.moveTo(cx - tableHalf, tableY)
  ctx.lineTo(cx + tableHalf, tableY)
  ctx.lineTo(cx + crownHalf, girdleY)
  ctx.lineTo(cx - crownHalf, girdleY)
  ctx.closePath()
  const crownGrad = ctx.createLinearGradient(cx, tableY, cx, girdleY)
  crownGrad.addColorStop(0, '#bdf3fa')
  crownGrad.addColorStop(1, CYAN)
  ctx.fillStyle = crownGrad
  ctx.fill()
  ctx.stroke()

  // Three facet lines on the crown, fanning from the table's corners and centre to the girdle.
  ctx.beginPath()
  ctx.moveTo(cx - tableHalf * 0.6, tableY)
  ctx.lineTo(cx - crownHalf * 0.55, girdleY)
  ctx.moveTo(cx, tableY)
  ctx.lineTo(cx, girdleY)
  ctx.moveTo(cx + tableHalf * 0.6, tableY)
  ctx.lineTo(cx + crownHalf * 0.55, girdleY)
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = size * 0.01
  ctx.stroke()

  // Pavilion: a triangle coming to a single point below the girdle.
  ctx.beginPath()
  ctx.moveTo(cx - crownHalf, girdleY)
  ctx.lineTo(cx + crownHalf, girdleY)
  ctx.lineTo(cx, pavilionTipY)
  ctx.closePath()
  const pavilionGrad = ctx.createLinearGradient(cx, girdleY, cx, pavilionTipY)
  pavilionGrad.addColorStop(0, '#8fe6f2')
  pavilionGrad.addColorStop(1, '#2f8fa0')
  ctx.fillStyle = pavilionGrad
  ctx.strokeStyle = 'rgba(20,70,80,0.55)'
  ctx.lineWidth = size * 0.012
  ctx.fill()
  ctx.stroke()

  // Pavilion facets converging on the point.
  ctx.beginPath()
  ctx.moveTo(cx - crownHalf * 0.5, girdleY)
  ctx.lineTo(cx, pavilionTipY)
  ctx.moveTo(cx + crownHalf * 0.5, girdleY)
  ctx.lineTo(cx, pavilionTipY)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = size * 0.01
  ctx.stroke()

  // A four-point white sparkle on the crown's upper-left facet.
  const sx = cx - crownHalf * 0.32
  const sy = tableY + size * 0.03
  const sparkleLong = size * 0.05
  const sparkleShort = size * 0.012
  ctx.beginPath()
  ctx.moveTo(sx, sy - sparkleLong)
  ctx.lineTo(sx + sparkleShort, sy - sparkleShort)
  ctx.lineTo(sx + sparkleLong, sy)
  ctx.lineTo(sx + sparkleShort, sy + sparkleShort)
  ctx.lineTo(sx, sy + sparkleLong)
  ctx.lineTo(sx - sparkleShort, sy + sparkleShort)
  ctx.lineTo(sx - sparkleLong, sy)
  ctx.lineTo(sx - sparkleShort, sy - sparkleShort)
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()
}

function drawCherry(ctx: CanvasRenderingContext2D, size: number): void {
  const cx = size / 2
  const stemTopY = size * 0.18
  const r = size * 0.15
  const leftX = cx - size * 0.13
  const rightX = cx + size * 0.13
  const cherryY = size * 0.68
  ctx.save()
  ctx.strokeStyle = '#3f7d32'
  ctx.lineWidth = size * 0.025
  ctx.beginPath()
  ctx.moveTo(cx, stemTopY)
  ctx.quadraticCurveTo(cx - size * 0.05, size * 0.4, leftX, cherryY - r * 0.6)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, stemTopY)
  ctx.quadraticCurveTo(cx + size * 0.05, size * 0.4, rightX, cherryY - r * 0.6)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(cx + size * 0.07, stemTopY + size * 0.02, size * 0.09, size * 0.045, -0.5, 0, Math.PI * 2)
  ctx.fillStyle = LEAF_GREEN
  ctx.fill()
  for (const [x, y] of [
    [leftX, cherryY],
    [rightX, cherryY],
  ] as const) {
    const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r)
    grad.addColorStop(0, '#ff8a93')
    grad.addColorStop(1, SEVEN_RED)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()
  }
  ctx.restore()
}

function drawLemon(ctx: CanvasRenderingContext2D, size: number): void {
  const cx = size / 2
  const cy = size / 2
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-0.35)
  const grad = ctx.createLinearGradient(-size * 0.3, -size * 0.2, size * 0.3, size * 0.2)
  grad.addColorStop(0, '#fff2a0')
  grad.addColorStop(1, YELLOW)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.ellipse(0, 0, size * 0.3, size * 0.22, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(180,140,0,0.35)'
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(Math.cos(a) * size * 0.14, Math.sin(a) * size * 0.09, size * 0.012, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.beginPath()
  ctx.ellipse(-size * 0.1, -size * 0.08, size * 0.1, size * 0.06, -0.4, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fill()
  ctx.restore()
}

function drawOrange(ctx: CanvasRenderingContext2D, size: number): void {
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.3
  ctx.save()
  const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r)
  grad.addColorStop(0, '#ffd27a')
  grad.addColorStop(1, ORANGE)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy - r * 0.85, r * 0.1, 0, Math.PI * 2)
  ctx.fillStyle = '#5b3a12'
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(cx + r * 0.5, cy - r * 0.9, r * 0.35, r * 0.16, -0.6, 0, Math.PI * 2)
  ctx.fillStyle = LEAF_GREEN
  ctx.fill()
  ctx.restore()
}

function drawPlum(ctx: CanvasRenderingContext2D, size: number): void {
  const cx = size / 2
  const cy = size / 2
  ctx.save()
  const grad = ctx.createRadialGradient(cx - size * 0.08, cy - size * 0.1, size * 0.05, cx, cy, size * 0.32)
  grad.addColorStop(0, '#c48fe0')
  grad.addColorStop(1, PLUM)
  ctx.beginPath()
  ctx.ellipse(cx, cy, size * 0.26, size * 0.32, 0, 0, Math.PI * 2)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(cx - size * 0.08, cy - size * 0.12, size * 0.08, size * 0.12, -0.3, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fill()
  ctx.restore()
}

function drawWild(ctx: CanvasRenderingContext2D, size: number): void {
  const cx = size / 2
  const cy = size / 2
  ctx.save()
  ctx.fillStyle = WILD_PURPLE
  ctx.beginPath()
  const spikes = 10
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (i / (spikes * 2)) * Math.PI * 2
    const r = i % 2 === 0 ? size * 0.34 : size * 0.2
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
  const bannerY = cy + size * 0.02
  ctx.fillStyle = '#3a1a52'
  roundRectPath(ctx, cx - size * 0.28, bannerY - size * 0.08, size * 0.56, size * 0.16, size * 0.02)
  ctx.fill()
  ctx.fillStyle = GOLD
  ctx.font = `800 ${size * 0.13}px Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('WILD', cx, bannerY)
  ctx.restore()
}

function drawScatter(ctx: CanvasRenderingContext2D, size: number): void {
  const cx = size / 2
  const cy = size * 0.42
  ctx.save()
  const glow = ctx.createRadialGradient(cx, cy, size * 0.05, cx, cy, size * 0.4)
  glow.addColorStop(0, 'rgba(243,210,122,0.55)')
  glow.addColorStop(1, 'rgba(243,210,122,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = SCATTER_GOLD
  ctx.beginPath()
  const spikes = 5
  const outerR = size * 0.26
  const innerR = size * 0.11
  for (let i = 0; i < spikes * 2; i++) {
    const angle = -Math.PI / 2 + (i / (spikes * 2)) * Math.PI * 2
    const r = i % 2 === 0 ? outerR : innerR
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
  ctx.font = `700 ${size * 0.1}px Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('SCATTER', cx, size * 0.82)
  ctx.restore()
}

function drawSymbol(canvas: HTMLCanvasElement, symbol: SymbolId): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for symbol texture')
  const size = canvas.width
  drawBackground(ctx, size)
  switch (symbol) {
    case 'seven':
      drawSeven(ctx, size)
      break
    case 'bar':
      drawBar(ctx, size)
      break
    case 'bell':
      drawBell(ctx, size)
      break
    case 'diamond':
      drawDiamond(ctx, size)
      break
    case 'cherry':
      drawCherry(ctx, size)
      break
    case 'lemon':
      drawLemon(ctx, size)
      break
    case 'orange':
      drawOrange(ctx, size)
      break
    case 'plum':
      drawPlum(ctx, size)
      break
    case 'wild':
      drawWild(ctx, size)
      break
    case 'scatter':
      drawScatter(ctx, size)
      break
  }
}

// -------------------------------------------------------------------------------------------
// Caches and exports
// -------------------------------------------------------------------------------------------

const symbolCanvasCache = new Map<SymbolId, HTMLCanvasElement>()
const symbolTextureCache = new Map<SymbolId, THREE.CanvasTexture>()

function getSymbolCanvas(symbol: SymbolId): HTMLCanvasElement {
  let canvas = symbolCanvasCache.get(symbol)
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.width = SYMBOL_CANVAS_SIZE
    canvas.height = SYMBOL_CANVAS_SIZE
    drawSymbol(canvas, symbol)
    symbolCanvasCache.set(symbol, canvas)
  }
  return canvas
}

/** A cached 256x256 canvas texture for one symbol, shared by every caller. */
export function makeSymbolTexture(symbol: SymbolId): THREE.CanvasTexture {
  let texture = symbolTextureCache.get(symbol)
  if (!texture) {
    texture = new THREE.CanvasTexture(getSymbolCanvas(symbol))
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    texture.needsUpdate = true
    symbolTextureCache.set(symbol, texture)
  }
  return texture
}

/** Disposes every cached symbol texture and canvas. */
export function disposeSymbolTextures(): void {
  for (const texture of symbolTextureCache.values()) texture.dispose()
  symbolTextureCache.clear()
  symbolCanvasCache.clear()
}

/**
 * A tall strip texture (256 wide, `cellHeight * strip.length` high, capped so a 34-symbol strip
 * stays under the 8192 canvas-height limit) with strip index `i` drawn at canvas row
 * `i * cellHeight`, index 0 at the top. The caller (`reelView.ts`) owns and disposes the result;
 * it is not cached, since every reel's strip differs.
 */
export function makeReelStripTexture(strip: readonly SymbolId[]): THREE.CanvasTexture {
  const cellHeight = strip.length > MAX_STRIP_FOR_FULL_CELL ? SHORT_CELL_HEIGHT : TALL_CELL_HEIGHT
  const width = SYMBOL_CANVAS_SIZE
  const height = cellHeight * strip.length
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for reel strip texture')
  for (let i = 0; i < strip.length; i++) {
    ctx.drawImage(getSymbolCanvas(strip[i]), 0, i * cellHeight, width, cellHeight)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  // Swap the geometry's circumference/length axes onto the canvas's height/width axes: see
  // `reelView.ts`'s header comment for the full derivation. `wrapT` is the axis this rotation
  // turns into the circumference, which must repeat seamlessly as the reel spins all the way
  // around.
  texture.center.set(0.5, 0.5)
  texture.rotation = Math.PI / 2
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}
