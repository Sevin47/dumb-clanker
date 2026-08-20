/**
 * Clank Script — the block language.
 *
 * Shaped like Scratch: stacks of blocks headed by a "when..." hat. One
 * deliberate simplification: conditions are not free-form nested expressions
 * but a fixed sensor / comparison / value triple. That covers nearly everything
 * a fighting robot needs to decide, and it removes the single fiddliest part of
 * a block editor for someone who does not program.
 *
 * The bot has three things that turn independently — the hull, the turret and
 * the radar — so most of the vocabulary is about pointing one of them.
 */

export type Category = 'event' | 'motion' | 'turret' | 'radar' | 'control';

export type SlotDef =
  | {
      kind: 'number';
      def: number;
      min: number;
      max: number;
      unit?: string;
      /** Angles may be negative, which is what lets a sensor steer a turn. */
      signed?: boolean;
    }
  | { kind: 'choice'; def: string; options: Array<[string, string]> }
  | { kind: 'sensor'; def: string }
  | { kind: 'compare'; def: string };

export interface BlockDef {
  op: string;
  cat: Category;
  text: string;
  slots?: Record<string, SlotDef>;
  hat?: boolean;
  bodies?: 1 | 2;
  priority?: number;
  help: string;
}

/**
 * Everything a bot can know. "Target" always means the bot you last scanned.
 *
 * Any number slot in any block can be driven by one of these instead of a fixed
 * value, which is what makes aiming something you build rather than something
 * you are given. The three "turn needed" readings are **signed** — negative
 * means left — so `turn turret right [turret turn needed]` swings the gun the
 * correct way on its own.
 */
export const SENSORS: Array<[string, string, string]> = [
  ['target_distance', 'distance to target', 'How far away the bot you last scanned is, in metres. Reads 999 if you have never scanned anyone.'],
  ['turret_turn', 'turret turn needed (- is left)', 'Degrees to swing the turret onto the target. Negative means left. Feed this into a turn block to aim.'],
  ['radar_turn', 'radar turn needed (- is left)', 'Degrees to swing the radar onto the target. Negative means left. Feed this into a turn block to track them.'],
  ['hull_turn', 'hull turn needed (- is left)', 'Degrees to turn the hull to face the target. Negative means left.'],
  ['gun_error', 'how far my turret is off target', 'Degrees the turret is off, ignoring direction. Test this before firing.'],
  ['radar_error', 'how far my radar is off target', 'Degrees the radar is off, ignoring direction.'],
  ['target_bearing', 'angle from my nose to target', 'How far the hull is off facing them, ignoring direction.'],
  ['target_age', 'seconds since I scanned them', 'How stale your information is. 0 means you can see them right now.'],
  ['target_health', 'target health %', 'How hurt the bot you last scanned was when you saw them.'],
  ['gun_heat', 'my gun heat', 'You cannot fire until this reaches 0.'],
  ['my_health', 'my health %', 'How much of you is left, 0 to 100.'],
  ['my_speed', 'my speed', 'How fast you are travelling, in metres per second.'],
  ['wall_distance', 'distance to the wall', 'How far the nearest arena wall is, in metres.'],
  ['bots_left', 'bots still alive', 'Including you.'],
  ['time_left', 'seconds left', 'Seconds remaining in the match.'],
];

export const COMPARES: Array<[string, string]> = [
  ['lt', 'is less than'],
  ['gt', 'is more than'],
  ['eq', 'is'],
];

const DIR: Array<[string, string]> = [
  ['left', 'left'],
  ['right', 'right'],
];

export const BLOCKS: BlockDef[] = [
  // ------------------------------------------------------------- events
  {
    op: 'when_start',
    cat: 'event',
    text: 'when the match starts',
    hat: true,
    priority: 0,
    help: 'Your main plan. Put a "forever" block in here so it keeps going all match.',
  },
  {
    op: 'when_scanned',
    cat: 'event',
    text: 'when my radar spots a bot',
    hat: true,
    priority: 3,
    help: 'Runs every time the radar beam sweeps across someone. This is where most bots do their shooting.',
  },
  {
    op: 'when_shot',
    cat: 'event',
    text: 'when a bullet hits me',
    hat: true,
    priority: 4,
    help: 'Somebody is shooting at you. A good place to start moving unpredictably.',
  },
  {
    op: 'when_wall',
    cat: 'event',
    text: 'when I hit a wall',
    hat: true,
    priority: 4,
    help: 'Runs when you drive into the edge of the arena, so you can back out of it.',
  },
  {
    op: 'when_bumped',
    cat: 'event',
    text: 'when I bump into another bot',
    hat: true,
    priority: 4,
    help: 'You have collided with someone. They are very close and probably shootable.',
  },
  {
    op: 'when_health_below',
    cat: 'event',
    text: 'when my health drops below {n} %',
    slots: { n: { kind: 'number', def: 40, min: 5, max: 95, unit: '%' } },
    hat: true,
    priority: 5,
    help: 'Runs once when you get badly hurt. Interrupts everything else.',
  },

  // ------------------------------------------------------------- motion
  {
    op: 'drive',
    cat: 'motion',
    text: 'drive {dir} for {n} s',
    slots: {
      dir: { kind: 'choice', def: 'forward', options: [['forward', 'forward'], ['backward', 'backward']] },
      n: { kind: 'number', def: 1, min: 0.1, max: 10, unit: 's' },
    },
    help: 'Straight line, whichever way the hull happens to be pointing.',
  },
  {
    op: 'turn_body',
    cat: 'motion',
    text: 'turn hull {dir} {n} degrees',
    slots: {
      dir: { kind: 'choice', def: 'left', options: DIR },
      n: { kind: 'number', def: 90, min: -360, max: 360, unit: '°', signed: true },
    },
    help: 'Spin the hull on the spot. The turret keeps pointing where it was. Turning right by a negative amount turns left, which is how a sensor can steer it.',
  },
  {
    op: 'face_target',
    cat: 'motion',
    text: 'point hull at the target',
    help: 'Turn the hull until its nose is on the bot you last scanned.',
  },
  {
    op: 'charge',
    cat: 'motion',
    text: 'drive at the target for {n} s',
    slots: { n: { kind: 'number', def: 2, min: 0.2, max: 10, unit: 's' } },
    help: 'Point the hull at them and drive. Ramming hurts them, and you.',
  },
  {
    op: 'retreat',
    cat: 'motion',
    text: 'back away from the target for {n} s',
    slots: { n: { kind: 'number', def: 1.5, min: 0.2, max: 10, unit: 's' } },
    help: 'Reverse while keeping your nose pointed at them.',
  },
  {
    op: 'strafe',
    cat: 'motion',
    text: 'circle {dir} around the target for {n} s',
    slots: { dir: { kind: 'choice', def: 'left', options: DIR }, n: { kind: 'number', def: 2, min: 0.2, max: 10, unit: 's' } },
    help: 'Drive at right angles to them. Much harder to hit than driving straight.',
  },
  {
    op: 'stop',
    cat: 'motion',
    text: 'sit still for {n} s',
    slots: { n: { kind: 'number', def: 0.5, min: 0.1, max: 10, unit: 's' } },
    help: 'Let go of everything and coast to a halt. A stationary bot is an easy target.',
  },

  // ------------------------------------------------------------- turret
  {
    op: 'turn_turret',
    cat: 'turret',
    text: 'turn turret {dir} {n} degrees',
    slots: {
      dir: { kind: 'choice', def: 'right', options: DIR },
      n: { kind: 'number', def: 45, min: -360, max: 360, unit: '°', signed: true },
    },
    help: 'Swing the turret, independently of the hull. Set the amount to "turret turn needed" and this becomes your aiming block — it corrects once, so run it every lap.',
  },
  {
    op: 'fire',
    cat: 'turret',
    text: 'fire with power {n}',
    slots: { n: { kind: 'number', def: 1.5, min: 0.5, max: 3, unit: '' } },
    help: 'Heavy shots hurt more but fly slower and leave the gun hot for longer. Does nothing while the gun is hot, so check "my gun heat" first.',
  },

  // ------------------------------------------------------------- radar
  {
    op: 'sweep',
    cat: 'radar',
    text: 'sweep radar {dir}',
    slots: { dir: { kind: 'choice', def: 'right', options: DIR } },
    help: 'Keep the radar turning that way until something else tells it to stop. This is how you find people.',
  },
  {
    op: 'turn_radar',
    cat: 'radar',
    text: 'turn radar {dir} {n} degrees',
    slots: {
      dir: { kind: 'choice', def: 'right', options: DIR },
      n: { kind: 'number', def: 90, min: -360, max: 360, unit: '°', signed: true },
    },
    help: 'Swing the radar and stop. Set the amount to "radar turn needed" to hold the beam on someone — but it only corrects once, so you must keep doing it.',
  },

  // ------------------------------------------------------------- control
  { op: 'forever', cat: 'control', text: 'forever', bodies: 1, help: 'Repeats what is inside it for the whole match.' },
  {
    op: 'repeat',
    cat: 'control',
    text: 'repeat {n} times',
    slots: { n: { kind: 'number', def: 4, min: 1, max: 50 } },
    bodies: 1,
    help: 'Runs what is inside it a set number of times.',
  },
  {
    op: 'if',
    cat: 'control',
    text: 'if {sensor} {cmp} {n} then',
    slots: {
      sensor: { kind: 'sensor', def: 'target_distance' },
      cmp: { kind: 'compare', def: 'lt' },
      n: { kind: 'number', def: 10, min: 0, max: 999 },
    },
    bodies: 1,
    help: 'Only runs what is inside when the test is true right now.',
  },
  {
    op: 'if_else',
    cat: 'control',
    text: 'if {sensor} {cmp} {n} then',
    slots: {
      sensor: { kind: 'sensor', def: 'target_distance' },
      cmp: { kind: 'compare', def: 'lt' },
      n: { kind: 'number', def: 10, min: 0, max: 999 },
    },
    bodies: 2,
    help: 'Runs the first part when the test is true, the second part when it is not.',
  },
  {
    op: 'wait',
    cat: 'control',
    text: 'wait {n} s',
    slots: { n: { kind: 'number', def: 0.5, min: 0.05, max: 10, unit: 's' } },
    help: 'Do nothing for a moment. Whatever you were already doing keeps happening.',
  },
  {
    op: 'wait_until',
    cat: 'control',
    text: 'wait until {sensor} {cmp} {n}',
    slots: {
      sensor: { kind: 'sensor', def: 'gun_heat' },
      cmp: { kind: 'compare', def: 'eq' },
      n: { kind: 'number', def: 0, min: 0, max: 999 },
    },
    help: 'Pause here until the test comes true. Gives up after 8 seconds so you cannot get stuck.',
  },
];

export const BLOCK_BY_OP: Record<string, BlockDef> = Object.fromEntries(BLOCKS.map((b) => [b.op, b]));
export const sensorLabel = (id: string) => SENSORS.find((s) => s[0] === id)?.[1] ?? id;
export const compareLabel = (id: string) => COMPARES.find((c) => c[0] === id)?.[1] ?? id;
