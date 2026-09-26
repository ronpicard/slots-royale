/**
 * The twenty fixed paylines. Each line is five row indices (reel 0 to 4, read left to right), one
 * row per reel: `PAYLINES[line][reel]` is 0 (top), 1 (middle) or 2 (bottom). Line 0 is the middle
 * row straight across; the rest add the top and bottom rows, a V and its mirror, a few shallow
 * zigzags, and two wide W/M shapes, so every payline in play is distinct.
 */

export const PAYLINES: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1], // 1: middle
  [0, 0, 0, 0, 0], // 2: top
  [2, 2, 2, 2, 2], // 3: bottom
  [0, 1, 2, 1, 0], // 4: V
  [2, 1, 0, 1, 2], // 5: inverted V
  [0, 0, 1, 0, 0], // 6: top with a dip
  [2, 2, 1, 2, 2], // 7: bottom with a rise
  [1, 0, 1, 0, 1], // 8: zigzag (upper)
  [1, 2, 1, 2, 1], // 9: zigzag (lower)
  [0, 1, 0, 1, 0], // 10: zigzag (top)
  [2, 1, 2, 1, 2], // 11: zigzag (bottom)
  [1, 1, 0, 1, 1], // 12: middle with a rise
  [1, 1, 2, 1, 1], // 13: middle with a dip
  [0, 2, 0, 2, 0], // 14: W (wide)
  [2, 0, 2, 0, 2], // 15: M (wide)
  [0, 2, 2, 2, 0], // 16: U
  [2, 0, 0, 0, 2], // 17: inverted U
  [0, 0, 2, 0, 0], // 18: top with a deep dip
  [2, 2, 0, 2, 2], // 19: bottom with a deep rise
  [1, 0, 2, 0, 1], // 20: shallow zigzag
]
