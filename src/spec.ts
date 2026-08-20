/**
 * The standard bot. Everyone gets exactly this one, so the only thing that can
 * make your bot better than someone else's is the program you wrote for it.
 */

export const BOT = {
  /** Half-extents of the hull, metres. */
  hx: 1.0,
  hy: 0.8,
  mass: 120,

  hp: 140,

  /** Drive: absolute newtons, so the standard bot always handles identically. */
  driveForce: 1500,
  maxSpeed: 8.0,
  reverseFactor: 0.65,
  /** Sideways grip. Low enough to slide a little when you throw it around. */
  grip: 0.22,
  turnTorque: 1600,

  /** Turret, mounted on the roof. Turns independently of the hull. */
  turretTurnRate: 2.6, // radians / second
  barrel: 1.35, // metres, muzzle offset from the bot centre

  /** Radar, mounted on the turret but aimed independently of it. */
  radarTurnRate: 6.0, // radians / second — much faster than the gun
  radarArc: 12, // degrees, total beam width
  radarRange: 38, // metres — reaches most of the field, but not the far corners
} as const;

/**
 * Gun maths. Heavier shots hurt more, fly slower, and lock the gun up longer.
 *
 * The spread between light and heavy has to be wide or power 3 is simply the
 * right answer every time: measured with a narrow spread, bots hit with almost
 * every shot and the bot that fired hardest won regardless of how it played.
 * A power-3 round now crawls at 10 m/s against bots that move at 8, so heavy
 * shots genuinely miss anything that is not asleep.
 */
export const GUN = {
  minPower: 0.5,
  maxPower: 3.0,
  /** Damage per shot. */
  damage: (power: number) => 4 * power + Math.max(0, 2 * (power - 1)),
  /** Metres per second. */
  speed: (power: number) => 22 - 4 * power,
  /** Heat added when the shot leaves the barrel. */
  heat: (power: number) => 0.6 + power / 2,
  /** Heat shed per second. */
  coolingRate: 0.7,
  /** Heat the gun starts a match with, so nobody opens fire instantly. */
  startHeat: 1.6,
} as const;

/** Damage from things that are not bullets. */
export const IMPACT = {
  /** Damage per m/s of closing speed when two bots collide. */
  ramPerSpeed: 0.9,
  ramMin: 1.2,
  /** Driving into a wall above this speed hurts. */
  wallSafeSpeed: 3.0,
  wallPerSpeed: 1.1,
  /** Minimum seconds between two collision hits on the same bot. */
  cooldown: 0.4,
} as const;

export const ARENA_SIZE = 36;
export const MATCH_SECONDS = 120;

/** Colours for up to six bots. The player is always the first. */
export const BOT_COLORS: Array<{ body: string; dark: string; light: string; name: string }> = [
  { body: '#3f7fd4', dark: '#2a5590', light: '#8fc0ff', name: 'blue' },
  { body: '#d0524a', dark: '#8f3630', light: '#ff9a90', name: 'red' },
  { body: '#6fc98a', dark: '#3f7d55', light: '#a8e8bd', name: 'green' },
  { body: '#d9a13a', dark: '#95681f', light: '#ffd68a', name: 'amber' },
  { body: '#a98ad6', dark: '#6d5296', light: '#d4c0f5', name: 'violet' },
  { body: '#57bfb4', dark: '#2f7a72', light: '#95e6dd', name: 'teal' },
];
