/**
 * Where everything stands in the world, in inches. three.js world axes: `y` is up, the player
 * stands on the `+z` side of the machine looking toward `-z`. The floor is `y = 0`.
 *
 * The machine is an upright cabinet centred on `x = 0`, its back at `CABINET_MIN_Z`, its glass
 * reel window facing `+z`. The room module's "table" constants describe the cabinet's footprint
 * so the casino floor keeps clear of it.
 */

/** Height of the felt on the background gaming tables (the room module uses it). */
export const TABLE_HEIGHT = 30

/** Cabinet footprint and height. */
export const CABINET_WIDTH = 30
export const CABINET_DEPTH = 22
export const CABINET_HEIGHT = 62
export const CABINET_MIN_X = -CABINET_WIDTH / 2
export const CABINET_MAX_X = CABINET_WIDTH / 2
export const CABINET_MIN_Z = -CABINET_DEPTH / 2
export const CABINET_MAX_Z = CABINET_DEPTH / 2

/** The same box under the names the room and confetti modules expect. */
export const TABLE_MIN_X = CABINET_MIN_X
export const TABLE_MAX_X = CABINET_MAX_X
export const TABLE_MIN_Z = CABINET_MIN_Z
export const TABLE_MAX_Z = CABINET_MAX_Z

/**
 * The reel window: a glass panel on the cabinet's front, centred at `REEL_WINDOW_Y`, showing
 * three rows of five symbols. Each symbol cell is `CELL_WIDTH` by `CELL_HEIGHT`.
 */
export const REEL_WINDOW_Y = 46
export const REEL_WINDOW_Z = CABINET_MAX_Z
export const REEL_WINDOW_WIDTH = 24
export const REEL_WINDOW_HEIGHT = 13.5
export const CELL_WIDTH = REEL_WINDOW_WIDTH / 5
export const CELL_HEIGHT = REEL_WINDOW_HEIGHT / 3
/** The reels are cylinders behind the glass, this radius about an axis along `x`. */
export const REEL_RADIUS = 9
export const REEL_AXIS_Z = REEL_WINDOW_Z - REEL_RADIUS - 0.6

/** The lit topper above the cabinet, and the button deck that slopes toward the player. */
export const TOPPER_Y = CABINET_HEIGHT + 9
export const TOPPER_HEIGHT = 16
export const DECK_Y = 34
export const DECK_Z = CABINET_MAX_Z + 4
/** The pull lever on the cabinet's right side, seen from the player. */
export const LEVER_X = CABINET_MAX_X + 2
export const LEVER_Y = 44
/** The coin tray below the deck. */
export const TRAY_Y = 22

/** Where the player stands (their eye), and the point spectators watch by default. */
export const PLAYER_EYE = { x: 0, y: 60, z: CABINET_MAX_Z + 30 }
export const FOCUS_X = 0
export const FOCUS_Y = REEL_WINDOW_Y
export const FOCUS_Z = REEL_WINDOW_Z

/**
 * The casino room keeps this box clear around the machine (floor to ceiling), apart from the
 * stool in front of it, so every camera view sees the cabinet unobstructed.
 */
export const ROOM_CLEAR_MIN_X = -60
export const ROOM_CLEAR_MAX_X = 60
export const ROOM_CLEAR_MIN_Z = -40
export const ROOM_CLEAR_MAX_Z = 60

export interface Point3 {
  x: number
  y: number
  z: number
}

/** World position of the centre of a reel-window cell on the glass. Reel 0 is leftmost, row 0 the top. */
export function cellPosition(reel: number, row: number): Point3 {
  return {
    x: (reel - 2) * CELL_WIDTH,
    y: REEL_WINDOW_Y + (1 - row) * CELL_HEIGHT,
    z: REEL_WINDOW_Z,
  }
}
