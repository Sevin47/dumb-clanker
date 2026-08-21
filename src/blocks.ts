/**
 * Clank Script — the block language.
 *
 * Shaped like Scratch: stacks of blocks headed by a "when..." hat.
 *
 * Two rules keep it honest:
 *
 * 1. **No block both senses and acts.** A block reports, or moves something, or
 *    fires. Deciding is the player's job.
 * 2. **Amounts are typed.** Every number slot has a unit, and only sensors
 *    measuring that unit can drive it. "Drive forward for [bots still alive]
 *    seconds" is not a sentence, so the editor never offers it.
 */

export type Category = 'event' | 'motion' | 'turret' | 'radar' | 'control';

/** What a number means. Slots only accept sensors of a matching unit. */
export type Unit = 'time' | 'angle' | 'distance' | 'percent' | 'speed' | 'heat' | 'count' | 'power';

export const UNIT_LABEL: Record<Unit, string> = {
  time: 'seconds',
  angle: 'degrees',
  distance: 'metres',
  percent: '%',
  speed: 'm/s',
  heat: 'heat',
  count: 'bots',
  power: 'power',
};

export type SlotDef =
  | {
      kind: 'number';
      def: number;
      min: number;
      max: number;
      /** Which sensors may drive this slot. 'match' means "same unit as the sensor slot". */
      unit: Unit | 'match';
      suffix?: string;
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
  /** One sentence on what it does, then one on when it finishes. */
  help: string;
}

export interface SensorDef {
  id: string;
  label: string;
  unit: Unit;
  help: string;
}

/**
 * Everything a bot can know. "The target" always means the last bot your radar
 * swept across — not necessarily where it is now.
 */
export const SENSORS: SensorDef[] = [
  {
    id: 'target_distance',
    label: 'distance to the target',
    unit: 'distance',
    help: 'Metres to the last bot you scanned. Reads 999 until you have scanned somebody.',
  },
  {
    id: 'turret_turn',
    label: 'turret: how far to turn (− left)',
    unit: 'angle',
    help: 'Degrees the turret must swing to point at the target. Negative means turn left. Put this in a turn-turret block and the gun aims itself.',
  },
  {
    id: 'radar_turn',
    label: 'radar: how far to turn (− left)',
    unit: 'angle',
    help: 'Degrees the radar must swing to point at the target. Negative means turn left. Put this in a turn-radar block to hold the beam on somebody.',
  },
  {
    id: 'hull_turn',
    label: 'hull: how far to turn (− left)',
    unit: 'angle',
    help: 'Degrees the hull must turn to face the target. Negative means turn left.',
  },
  {
    id: 'gun_error',
    label: 'turret: how far off target',
    unit: 'angle',
    help: 'The same as "turret: how far to turn" but never negative. Use it to test whether the gun is lined up before firing.',
  },
  {
    id: 'radar_error',
    label: 'radar: how far off target',
    unit: 'angle',
    help: 'How far the radar is off the target, ignoring which side.',
  },
  {
    id: 'target_bearing',
    label: 'hull: how far off target',
    unit: 'angle',
    help: 'How far the hull is off facing the target, ignoring which side.',
  },
  {
    id: 'target_age',
    label: 'seconds since I scanned them',
    unit: 'time',
    help: 'How stale your information is. 0 means the beam is on them right now. The older this gets, the more your aim is guessing.',
  },
  { id: 'target_health', label: 'the target’s health %', unit: 'percent', help: 'How hurt they were when you last saw them, 0 to 100.' },
  {
    id: 'gun_heat',
    label: 'my gun heat',
    unit: 'heat',
    help: 'Firing does nothing until this reaches 0. A power-3 shot leaves about 2.1 heat, and heat falls by 0.7 per second.',
  },
  { id: 'my_health', label: 'my health %', unit: 'percent', help: 'How much of you is left, 0 to 100.' },
  { id: 'my_speed', label: 'my speed', unit: 'speed', help: 'How fast you are actually moving, in metres per second. Top speed is 10.' },
  {
    id: 'turret_remaining',
    label: 'turret: turn still to go',
    unit: 'angle',
    help: 'How far the turret has left to travel to reach the heading you last sent it to. Reads 0 when it has arrived, or when you never told it to go anywhere. This is about the gun, not the enemy: a stale order that has finished reads 0 even if they walked away. To decide whether to fire, "turret: how far off target" is usually the better test. This one answers a different question: did the swing I asked for land.',
  },
  {
    id: 'radar_remaining',
    label: 'radar: turn still to go',
    unit: 'angle',
    help: 'How far the radar has left to travel to reach the heading you last sent it to. Reads 0 while it is sweeping, because a sweep never arrives anywhere.',
  },
  {
    id: 'hull_remaining',
    label: 'hull: turn still to go',
    unit: 'angle',
    help: 'How far the hull has left to travel to reach the heading you last sent it to with "start turning hull". Reads 0 once it settles, or if you never sent it anywhere.',
  },
  {
    id: 'wall_distance',
    label: 'distance to the nearest wall',
    unit: 'distance',
    help: 'Metres to the closest edge of the arena, in any direction. It cannot tell you which wall, so a bot driving safely alongside one reads the same as a bot about to hit it.',
  },
  {
    id: 'wall_ahead',
    label: 'clear space ahead of me',
    unit: 'distance',
    help: 'Metres of open floor in front of the nose, along the way the hull points. Reads 0 when you are touching. This is the one to test before driving forward. Reversing, the wall that matters is behind you and this will not see it.',
  },
  { id: 'bots_left', label: 'bots still alive', unit: 'count', help: 'How many bots are still fighting, including you.' },
  { id: 'time_left', label: 'seconds left in the battle', unit: 'time', help: 'Seconds remaining before the battle is decided on health.' },
];

export const SENSOR_BY_ID: Record<string, SensorDef> = Object.fromEntries(SENSORS.map((s) => [s.id, s]));
export const sensorsFor = (unit: Unit) => SENSORS.filter((s) => s.unit === unit);

export const COMPARES: Array<[string, string]> = [
  ['lt', 'is less than'],
  ['gt', 'is more than'],
  ['eq', 'is about'],
];

const DIR: Array<[string, string]> = [
  ['left', 'left'],
  ['right', 'right'],
];

const secs = (def: number): SlotDef => ({ kind: 'number', def, min: 0.05, max: 10, unit: 'time', suffix: 'seconds' });
const degrees = (def: number): SlotDef => ({
  kind: 'number',
  def,
  min: -360,
  max: 360,
  unit: 'angle',
  suffix: 'degrees',
  signed: true,
});

export const BLOCKS: BlockDef[] = [
  // ------------------------------------------------------------- events
  {
    op: 'when_start',
    cat: 'event',
    text: 'when the battle starts',
    hat: true,
    priority: 0,
    help: 'Runs once, at the start. This is your standing plan. put a "forever" block inside it or the bot will finish and then do nothing.',
  },
  {
    op: 'when_scanned',
    cat: 'event',
    text: 'when my radar passes over a bot',
    hat: true,
    priority: 3,
    help: 'Runs each time your radar beam crosses another bot, which also sets "the target" to them. It interrupts your standing plan, runs to the end, then the plan carries on where it left off.',
  },
  {
    op: 'when_shot',
    cat: 'event',
    text: 'when a bullet hits me',
    hat: true,
    priority: 4,
    help: 'Runs when you take a hit. Interrupts whatever you were doing.',
  },
  {
    op: 'when_wall',
    cat: 'event',
    text: 'when I run into a wall',
    hat: true,
    priority: 4,
    help: 'Runs while you are pressed against the edge of the arena. Back off and turn, or you will sit there.',
  },
  {
    op: 'when_bumped',
    cat: 'event',
    text: 'when I bump into another bot',
    hat: true,
    priority: 4,
    help: 'Runs when you collide with somebody. Both of you take a little damage, and they are point-blank.',
  },
  {
    op: 'when_health_below',
    cat: 'event',
    text: 'when my health drops below {n}',
    slots: { n: { kind: 'number', def: 40, min: 5, max: 95, unit: 'percent', suffix: '%' } },
    hat: true,
    priority: 5,
    help: 'Runs once when you cross that level going down. It will not run again unless you heal, which you cannot, so treat it as a one-off panic plan.',
  },

  // ------------------------------------------------------------- motion
  {
    op: 'drive',
    cat: 'motion',
    text: 'drive {dir} for {n}',
    slots: {
      dir: { kind: 'choice', def: 'forward', options: [['forward', 'forward'], ['backward', 'backward']] },
      n: secs(1),
    },
    help: 'Drives in a straight line, whichever way the hull already points. Finishes when the time is up. Reverse tops out at about two thirds of forward speed.',
  },
  {
    op: 'turn_body',
    cat: 'motion',
    text: 'turn hull {dir} by {n}',
    slots: { dir: { kind: 'choice', def: 'left', options: DIR }, n: degrees(90) },
    help: 'Spins the hull on the spot; the turret and radar keep pointing where they were. Finishes once it has turned that far, or after 5 seconds if something is in the way. A negative amount turns the opposite way.',
  },
  {
    op: 'drive_start',
    cat: 'motion',
    text: 'start driving {dir}',
    slots: { dir: { kind: 'choice', def: 'forward', options: [['forward', 'forward'], ['backward', 'backward']] } },
    help: 'Sets the throttle and moves straight on to the next block. It does not wait and it has no duration: the bot keeps driving until another motion block changes it. Unlike "drive for", it leaves the steering alone, so you can be turning at the same time.',
  },
  {
    op: 'turn_body_start',
    cat: 'motion',
    text: 'start turning hull {dir} by {n}',
    slots: { dir: { kind: 'choice', def: 'left', options: DIR }, n: degrees(90) },
    help: 'Points the hull at a heading and moves straight on. It does not wait. The bot keeps steering itself onto that heading while the rest of your script runs, and holds it once there. Any other motion block takes the wheel and cancels it, including "stop moving" and "drive for". Use "hull: turn still to go" to find out when it arrived.',
  },
  {
    op: 'face_target',
    cat: 'motion',
    text: 'point hull at the target',
    help: 'Turns the hull until its nose is within 9 degrees of the target, re-aiming as they move. Finishes then, or after 2.5 seconds. Does nothing useful if you have never scanned anyone.',
  },
  {
    op: 'charge',
    cat: 'motion',
    text: 'drive at the target for {n}',
    slots: { n: secs(2) },
    help: 'Steers at the target and drives flat out, re-aiming every tick for the whole time. Finishes when the time is up. Because it keeps steering, it will overwrite a heading you just turned to, so do not use it in the same lap as a wall escape. Colliding hurts you both.',
  },
  {
    op: 'retreat',
    cat: 'motion',
    text: 'back away from the target for {n}',
    slots: { n: secs(1.5) },
    help: 'Reverses while keeping your nose pointed at them, re-aiming every tick for the whole time. Finishes when the time is up. Because it keeps steering, it will overwrite a heading you just turned to.',
  },
  {
    op: 'strafe',
    cat: 'motion',
    text: 'circle {dir} around the target for {n}',
    slots: { dir: { kind: 'choice', def: 'left', options: DIR }, n: secs(2) },
    help: 'Drives at right angles to the target, re-aiming every tick for the whole time. The hardest movement to shoot, but your own gun is not pointing at them. Because it keeps steering, it will overwrite a heading you just turned to, so do not use it in the same lap as a wall escape.',
  },
  {
    op: 'stop',
    cat: 'motion',
    text: 'stop moving for {n}',
    slots: { n: secs(0.5) },
    help: 'Releases the throttle and coasts. It does not brake, so you keep sliding for a moment. A stationary bot is easy to hit.',
  },

  // ------------------------------------------------------------- turret
  {
    op: 'turn_turret',
    cat: 'turret',
    text: 'turn turret {dir} by {n}',
    slots: { dir: { kind: 'choice', def: 'right', options: DIR }, n: degrees(45) },
    help: 'Swings the turret independently of the hull, about 149 degrees a second, and waits until it arrives. Set the amount to "turret: how far to turn" and it aims at the target, but only at where they were at that instant, so run it every lap. Nothing else in the script runs while it swings.',
  },
  {
    op: 'turret_start',
    cat: 'turret',
    text: 'start turret turning {dir} by {n}',
    slots: { dir: { kind: 'choice', def: 'right', options: DIR }, n: degrees(45) },
    help: 'The same swing, but it does not wait. The next block runs at once while the gun keeps turning on its own. Use it to stay alert while aiming, and remember the gun has not moved yet: test "turret: how far off target" on a later lap before you fire, not on this one.',
  },
  {
    op: 'fire',
    cat: 'turret',
    text: 'fire with power {n}',
    slots: { n: { kind: 'number', def: 1.5, min: 0.5, max: 3, unit: 'power', suffix: '' } },
    help: 'Fires instantly and moves straight to the next block. Does nothing at all if the gun is still hot. Power 0.5 does 2 damage at 20 m/s; power 3 does 16 at 10 m/s and locks the gun for about 3 seconds.',
  },

  // ------------------------------------------------------------- radar
  {
    op: 'sweep',
    cat: 'radar',
    text: 'start sweeping radar {dir}',
    slots: { dir: { kind: 'choice', def: 'right', options: DIR } },
    help: 'Sets the radar spinning and moves straight on. it does not wait. The beam keeps turning until another radar block changes it. This is how you find people.',
  },
  {
    op: 'turn_radar',
    cat: 'radar',
    text: 'turn radar {dir} by {n}',
    slots: { dir: { kind: 'choice', def: 'right', options: DIR }, n: degrees(90) },
    help: 'Stops any sweep and swings the radar by that much, about 344 degrees a second, waiting until it arrives. Set the amount to "radar: how far to turn" to hold the beam on the target. Once per run, so repeat it.',
  },
  {
    op: 'radar_start',
    cat: 'radar',
    text: 'start radar turning {dir} by {n}',
    slots: { dir: { kind: 'choice', def: 'right', options: DIR }, n: degrees(90) },
    help: 'The same turn, but it does not wait. The next block runs at once while the beam keeps going on its own.',
  },

  // ------------------------------------------------------------- control
  {
    op: 'forever',
    cat: 'control',
    text: 'forever',
    bodies: 1,
    help: 'Repeats what is inside for the whole battle. One lap per tick at most, so an empty forever cannot lock the game up.',
  },
  {
    op: 'repeat',
    cat: 'control',
    text: 'repeat {n} times',
    slots: { n: { kind: 'number', def: 4, min: 1, max: 50, unit: 'count', suffix: '' } },
    bodies: 1,
    help: 'Runs what is inside a set number of times, then carries on to the next block.',
  },
  {
    op: 'if',
    cat: 'control',
    text: 'if {sensor} {cmp} {n} then',
    slots: {
      sensor: { kind: 'sensor', def: 'target_distance' },
      cmp: { kind: 'compare', def: 'lt' },
      n: { kind: 'number', def: 10, min: -999, max: 999, unit: 'match' },
    },
    bodies: 1,
    help: 'Checks once, right now, and runs the inside only if it is true. It does not keep watching. The value on the right must measure the same thing as the sensor on the left.',
  },
  {
    op: 'if_else',
    cat: 'control',
    text: 'if {sensor} {cmp} {n} then',
    slots: {
      sensor: { kind: 'sensor', def: 'target_distance' },
      cmp: { kind: 'compare', def: 'lt' },
      n: { kind: 'number', def: 10, min: -999, max: 999, unit: 'match' },
    },
    bodies: 2,
    help: 'Runs the first part if the test is true right now, otherwise the second part.',
  },
  {
    op: 'wait',
    cat: 'control',
    text: 'wait for {n}',
    slots: { n: secs(0.5) },
    help: 'Pauses the script. Whatever the bot was already doing. driving, sweeping. carries on while it waits.',
  },
  {
    op: 'wait_until',
    cat: 'control',
    text: 'wait until {sensor} {cmp} {n}',
    slots: {
      sensor: { kind: 'sensor', def: 'gun_heat' },
      cmp: { kind: 'compare', def: 'lt' },
      n: { kind: 'number', def: 1, min: -999, max: 999, unit: 'match' },
    },
    help: 'Holds here until the test comes true, then carries on. Gives up after 8 seconds so a test that never comes true cannot freeze your bot.',
  },
];

export const BLOCK_BY_OP: Record<string, BlockDef> = Object.fromEntries(BLOCKS.map((b) => [b.op, b]));
export const sensorLabel = (id: string) => SENSOR_BY_ID[id]?.label ?? id;
export const compareLabel = (id: string) => COMPARES.find((c) => c[0] === id)?.[1] ?? id;

/** Which sensors may drive this slot, given the block it sits in. */
export function allowedSensors(def: BlockDef, key: string, args: Record<string, string | number>): SensorDef[] {
  const slot = def.slots?.[key];
  if (!slot || slot.kind !== 'number') return [];
  if (slot.unit !== 'match') return sensorsFor(slot.unit);
  // A comparison's right-hand side has to measure whatever the left side does.
  const chosen = SENSOR_BY_ID[String(args.sensor ?? '')];
  return chosen ? sensorsFor(chosen.unit) : [];
}

/** The unit shown after a slot, e.g. "seconds" or "%". */
export function slotSuffix(def: BlockDef, key: string, args: Record<string, string | number>): string {
  const slot = def.slots?.[key];
  if (!slot || slot.kind !== 'number') return '';
  // '' is a real answer, not a missing one. A block whose own text already names
  // the unit sets it, because "fire with power 3 power" reads badly.
  if (slot.suffix !== undefined) return slot.suffix;
  if (slot.unit === 'match') {
    const chosen = SENSOR_BY_ID[String(args.sensor ?? '')];
    return chosen ? UNIT_LABEL[chosen.unit] : '';
  }
  return UNIT_LABEL[slot.unit] ?? '';
}
