/** Global tuning constants. Everything the "feel" depends on lives here. */

/** Internal 3D render resolution. Upscaled with no smoothing to stay pixel-y. */
export const VIEW_W = 640;
export const VIEW_H = 360;

/**
 * The HUD has its own fixed layout space, independent of the 3D buffer, so
 * changing the render resolution never rescales the readouts.
 */
export const HUD_W = 480;
export const HUD_H = 270;

/**
 * Arena floor, in metres. Squarer than the original top-down pit: a chase
 * camera spends far too much time jammed against a long wall otherwise.
 */
export const ARENA_W = 24;
export const ARENA_H = 18;

/** Fixed simulation step. */
export const DT = 1 / 60;

/** Match length in seconds. If nobody dies, most-intact bot wins. */
export const MATCH_TIME = 90;

/** Collision groups: fixtures sharing a negative group never collide with each other. */
export const GROUP_PLAYER = -1;
export const GROUP_ENEMY = -2;

/** Minimum seconds between two damaging hits from the same weapon on the same target. */
export const HIT_COOLDOWN = 0.14;

/**
 * Impulse below this is grinding, not a collision. Measured: sustained contact
 * sits around 11, while a genuine impact is 130+. Anything under the threshold
 * must not deal damage, or two bots leaning on each other slowly kill both.
 */
export const MIN_IMPULSE = 90;

/** Minimum seconds between two ramming impacts on the same bot. */
export const RAM_COOLDOWN = 0.35;
