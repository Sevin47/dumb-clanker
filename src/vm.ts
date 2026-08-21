import { BLOCK_BY_OP } from './blocks';
import type { Node, Program, Stack } from './program';
import type { Bot } from './bot';
import type { Match } from './match';
import { ARENA_W, ARENA_H } from './match';
import { BOT, GUN } from './spec';

/**
 * How much clear floor is in front of the nose.
 *
 * A ray from the bot's centre along its heading, against the four walls of the
 * arena. The slab method: for each axis, the ray reaches that wall at a known
 * multiple of its direction, and the nearest positive one is the wall it would
 * actually meet. Then take off the half-length of the hull, so the answer is
 * the gap in front of the bot rather than the distance to its middle.
 *
 * No physics query needed. The arena is an axis-aligned box and always will be.
 */
function clearAhead(x: number, y: number, heading: number): number {
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);

  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (ARENA_W - x) / dx);
  else if (dx < -1e-6) t = Math.min(t, -x / dx);
  if (dy > 1e-6) t = Math.min(t, (ARENA_H - y) / dy);
  else if (dy < -1e-6) t = Math.min(t, -y / dy);

  if (!Number.isFinite(t)) return 0;
  return Math.max(0, t - BOT.hx);
}

/**
 * Runs one bot's Clank Script.
 *
 * Model: the "when the match starts" stack is the bot's standing plan. Every
 * other hat is an interrupt — when it fires it takes over, runs to the end, and
 * then the standing plan carries on from exactly where it left off. That keeps
 * the mental model to one sentence and makes it impossible for two stacks to
 * fight over the controls, which is the usual way Scratch-style concurrency
 * confuses people.
 *
 * Motion, turret and radar are three separate channels. A block only touches
 * the channel it names, so "sweep radar right" keeps sweeping while the hull
 * drives and the gun aims somewhere else entirely.
 */

export interface Senses {
  target_distance: number;
  /** Signed: negative means the target is to the left. These drive turn blocks. */
  turret_turn: number;
  radar_turn: number;
  hull_turn: number;
  /** Unsigned versions, for tests. */
  gun_error: number;
  radar_error: number;
  target_bearing: number;
  target_age: number;
  target_health: number;
  gun_heat: number;
  my_health: number;
  my_speed: number;
  wall_distance: number;
  wall_ahead: number;
  bots_left: number;
  time_left: number;
}

interface Frame {
  body: Node[];
  index: number;
  loop?: Node;
  repeats?: number;
}

interface Context {
  stack: Stack;
  frames: Frame[];
  action: Action | null;
  done: boolean;
}

interface Action {
  op: string;
  endsAt: number;
  deadline: number;
  dir?: string;
  power?: number;
  /** Absolute heading a turn is aiming to settle on. */
  headingTarget?: number;
}

const STEP_BUDGET = 300;
const deg = (r: number) => (r * 180) / Math.PI;

const clampTurn = (d: number) => Math.max(-360, Math.min(360, d));

const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export class ClankVM {
  private base: Context | null = null;
  private interrupt: Context | null = null;
  private interruptPriority = -1;
  private clock = 0;

  /** Each channel persists until a block changes it. */
  private throttle = 0;
  private turn = 0;
  private radarSpin = 0;
  private radarTarget: number | null = null;
  private turretTarget: number | null = null;

  private prevHealthHat: Record<string, boolean> = {};

  activeBlockId: string | null = null;
  note = '';

  /**
   * The three channels, as the bot is actually holding them.
   *
   * These persist. A drive block sets the throttle and nothing clears it until
   * another motion block runs, which is the single most surprising thing about
   * the language: aiming the turret for a second means driving blind for a
   * second. Hidden state that bites people should be on the screen.
   */
  get channels() {
    return {
      throttle: this.throttle,
      turn: this.turn,
      turretTarget: this.turretTarget,
      radarSpin: this.radarSpin,
      radarTarget: this.radarTarget,
    };
  }

  /**
   * Profiling, so the arena can show which blocks actually run and where the
   * time goes. A block that never runs is usually the bug: an event that never
   * fires, or a branch whose test is never true.
   */
  readonly hits = new Map<string, number>();
  readonly seconds = new Map<string, number>();
  elapsed = 0;

  /**
   * How many of an "if" block's checks came back true.
   *
   * A block that never runs is the obvious bug and the inspector already flags
   * it. The quieter one is a condition that runs constantly and is never once
   * true: the block inside it is dead, but the "if" itself looks perfectly
   * healthy because it is ticking over thousands of times.
   */
  readonly trueHits = new Map<string, number>();

  constructor(
    private bot: Bot,
    readonly program: Program,
  ) {}

  private tally(id: string) {
    this.hits.set(id, (this.hits.get(id) ?? 0) + 1);
  }

  /**
   * Throw away all running state and start the program again from the top.
   * Used by the recall button, so a script that has deadlocked itself can be
   * restarted without abandoning the battle.
   */
  restart() {
    this.base = null;
    this.interrupt = null;
    this.interruptPriority = -1;
    this.throttle = 0;
    this.turn = 0;
    this.radarSpin = 0;
    this.radarTarget = null;
    this.turretTarget = null;
    this.prevHealthHat = {};
    this.activeBlockId = null;
    this.note = '';
    this.trueHits.clear();
    this.bot.controls.throttle = 0;
    this.bot.controls.turn = 0;
    this.bot.controls.fire = 0;
    this.bot.controls.radarSpin = 0;
    this.bot.controls.radarTarget = null;
    this.bot.controls.turretTarget = null;
  }

  private hats(op: string): Stack[] {
    return this.program.stacks.filter((s) => s.hat.op === op);
  }

  private startContext(stack: Stack): Context {
    this.tally(stack.hat.id);
    return { stack, frames: [{ body: stack.body, index: 0 }], action: null, done: false };
  }

  // ---------------------------------------------------------------- senses

  senses(m: Match): Senses {
    const b = this.bot;
    const t = b.target;
    const p = b.position;
    const wall = Math.min(p.x, ARENA_W - p.x, p.y, ARENA_H - p.y);

    let turretTurn = 0;
    let radarTurn = 0;
    let hullTurn = 0;
    if (t) {
      const abs = b.angleTo(t);
      turretTurn = deg(wrap(abs - b.turret));
      radarTurn = deg(wrap(abs - b.radar));
      hullTurn = deg(wrap(abs - b.heading));
    }

    return {
      target_distance: t ? Math.hypot(t.x - p.x, t.y - p.y) : 999,
      turret_turn: turretTurn,
      radar_turn: radarTurn,
      hull_turn: hullTurn,
      gun_error: t ? Math.abs(turretTurn) : 180,
      radar_error: t ? Math.abs(radarTurn) : 180,
      target_bearing: t ? Math.abs(hullTurn) : 180,
      target_age: t ? t.age : 999,
      target_health: t ? t.health : 0,
      gun_heat: b.gunHeat,
      my_health: b.healthPct,
      my_speed: b.speed,
      wall_distance: Math.max(0, wall),
      wall_ahead: clearAhead(p.x, p.y, b.heading),
      bots_left: m.alive.length,
      time_left: m.timeLeft,
    };
  }

  /**
   * A number slot is either a fixed amount or a sensor reading plus an offset.
   * Feeding "turret turn needed" into a turn block is how a player builds aiming
   * out of parts, instead of being handed a block that does it for them.
   */
  private val(node: Node, key: string, s: Senses): number {
    const src = String(node.args[`${key}_src`] ?? '');
    const add = Number(node.args[key] ?? 0);
    if (!src) return add;
    const base = (s as unknown as Record<string, number>)[src];
    return (Number.isFinite(base) ? base : 0) + add;
  }

  private test(s: Senses, sensor: string, cmp: string, value: number): boolean {
    const v = (s as unknown as Record<string, number>)[sensor] ?? 0;
    if (cmp === 'lt') return v < value;
    if (cmp === 'gt') return v > value;
    return Math.abs(v - value) < 0.5;
  }

  // ---------------------------------------------------------------- events

  private checkHats(s: Senses) {
    const b = this.bot;
    const consider = (stack: Stack) => {
      const prio = BLOCK_BY_OP[stack.hat.op]?.priority ?? 1;
      if (this.interrupt && !this.interrupt.done && prio <= this.interruptPriority) return;
      this.interrupt = this.startContext(stack);
      this.interruptPriority = prio;
    };

    if (b.eventScanned) this.hats('when_scanned').forEach(consider);
    if (b.eventShot) this.hats('when_shot').forEach(consider);
    if (b.eventWall) this.hats('when_wall').forEach(consider);
    if (b.eventBumped) this.hats('when_bumped').forEach(consider);

    for (const st of this.hats('when_health_below')) {
      const limit = Number(st.hat.args.n ?? 40);
      if (s.my_health < limit && !this.prevHealthHat[st.id]) {
        this.prevHealthHat[st.id] = true;
        consider(st);
      }
      if (s.my_health > limit + 5) this.prevHealthHat[st.id] = false;
    }

    b.eventScanned = false;
    b.eventShot = false;
    b.eventWall = false;
    b.eventBumped = false;
  }

  // ---------------------------------------------------------------- actions

  private currentNode: Node | null = null;

  /** Returns an Action when the block occupies the bot for a while. */
  private startAction(node: Node, s: Senses): Action | null {
    const op = node.op;
    const secs = Math.max(0.05, Math.min(10, this.val(node, 'n', s)));
    const base: Action = { op, endsAt: this.clock + secs, deadline: this.clock + 12 };
    const b = this.bot;

    switch (op) {
      // --- motion channel ---
      case 'drive':
        this.throttle = String(node.args.dir) === 'backward' ? -1 : 1;
        this.turn = 0;
        return base;
      case 'charge':
      case 'retreat':
      case 'stop':
      case 'strafe':
        return { ...base, dir: String(node.args.dir ?? 'left') };
      case 'face_target':
        return { ...base, endsAt: this.clock + 2.5 };
      case 'turn_body': {
        // Aim at an absolute heading rather than counting degrees as they go by.
        // Counting overshoots badly: the hull is still spinning when the count
        // is reached and coasts on, so a "90 degree" turn delivered about 144.
        // A negative amount flips the direction, which is how a signed sensor
        // steers a turn with no arithmetic blocks in the language.
        const amount = clampTurn(this.val(node, 'n', s));
        const sign = String(node.args.dir) === 'left' ? -1 : 1;
        return {
          op,
          headingTarget: b.heading + (sign * amount * Math.PI) / 180,
          endsAt: this.clock + 6,
          deadline: this.clock + 6,
        };
      }

      // --- turret channel ---
      //
      // "turn" waits for the gun to arrive, "start turning" does not. The wait
      // is the only way this language can say "after it gets there", and
      // aim-then-fire depends on it: without it the fire block is reached in
      // the same tick, before the turret has moved at all, so the gun error is
      // still the error the aim was meant to remove.
      case 'turn_turret':
      case 'turret_start': {
        const amount = clampTurn(this.val(node, 'n', s));
        const sign = String(node.args.dir) === 'left' ? -1 : 1;
        this.turretTarget = b.turret + (sign * amount * Math.PI) / 180;
        if (op === 'turret_start') return null;
        return { op, endsAt: this.clock + 3, deadline: this.clock + 3 };
      }
      case 'fire':
        b.controls.fire = Math.max(0, Math.min(3, this.val(node, 'n', s)));
        return null;

      // --- radar channel ---
      case 'sweep':
        this.radarSpin = String(node.args.dir) === 'left' ? -1 : 1;
        this.radarTarget = null;
        return null;
      case 'turn_radar':
      case 'radar_start': {
        const amount = clampTurn(this.val(node, 'n', s));
        const sign = String(node.args.dir) === 'left' ? -1 : 1;
        this.radarSpin = 0;
        this.radarTarget = b.radar + (sign * amount * Math.PI) / 180;
        if (op === 'radar_start') return null;
        return { op, endsAt: this.clock + 3, deadline: this.clock + 3 };
      }

      // --- control ---
      case 'wait':
        return base;
      case 'wait_until': {
        if (this.test(s, String(node.args.sensor), String(node.args.cmp), this.val(node, 'n', s))) return null;
        return { op, endsAt: Infinity, deadline: this.clock + 8 };
      }
      default:
        return null;
    }
  }

  private actionDone(a: Action, s: Senses): boolean {
    if (this.clock >= a.deadline) return true;
    const b = this.bot;
    switch (a.op) {
      case 'face_target':
        return (
          (s.target_bearing < 9 && Math.abs(b.body.getAngularVelocity()) < 0.6) || this.clock >= a.endsAt
        );
      case 'turn_body': {
        // Settled means both pointing the right way and no longer spinning.
        const err = Math.abs(deg(wrap((a.headingTarget ?? b.heading) - b.heading)));
        return (err < 4 && Math.abs(b.body.getAngularVelocity()) < 0.5) || this.clock >= a.deadline;
      }
      case 'turn_radar':
        return b.radar === this.radarTarget || this.clock >= a.endsAt;
      case 'turn_turret':
        return b.turret === this.turretTarget || this.clock >= a.endsAt;
      case 'wait_until': {
        const node = this.currentNode;
        if (!node) return true;
        return this.test(s, String(node.args.sensor), String(node.args.cmp), this.val(node, 'n', s));
      }
      default:
        return this.clock >= a.endsAt;
    }
  }

  /** Re-evaluated every tick so aiming keeps tracking a moving target. */
  private applyChannels(a: Action | null) {
    const b = this.bot;
    const t = b.target;
    const angVel = b.body.getAngularVelocity();
    const toward = (rel: number) => Math.max(-1, Math.min(1, rel * 2.6 - angVel * 0.22));
    // Blocks that must *stop* on a heading need much heavier damping, or the
    // hull sails straight past the angle it was asked for.
    const settleOn = (rel: number) => Math.max(-1, Math.min(1, rel * 3.2 - angVel * 0.55));
    const relBearing = t ? wrap(b.angleTo(t) - b.heading) : 0;

    if (a) {
      switch (a.op) {
        case 'charge':
          this.throttle = 1;
          this.turn = toward(relBearing);
          break;
        case 'retreat':
          this.throttle = -1;
          this.turn = toward(-relBearing);
          break;
        case 'strafe':
          this.throttle = 0.9;
          this.turn = toward(relBearing + (a.dir === 'left' ? -Math.PI / 2 : Math.PI / 2));
          break;
        case 'face_target':
          this.throttle = 0;
          this.turn = settleOn(relBearing);
          break;
        case 'stop':
          this.throttle = 0;
          this.turn = 0;
          break;
        case 'turn_body':
          this.throttle = 0;
          this.turn = settleOn(wrap((a.headingTarget ?? b.heading) - b.heading));
          break;
        default:
          break;
      }
    }

    const c = b.controls;
    c.throttle = this.throttle;
    c.turn = this.turn;
    c.turretTarget = this.turretTarget;
    c.radarTarget = this.radarTarget;
    c.radarSpin = this.radarSpin;
  }

  // ---------------------------------------------------------------- stepping

  private step(ctx: Context, s: Senses) {
    let budget = STEP_BUDGET;

    while (budget-- > 0) {
      if (ctx.action) {
        if (!this.actionDone(ctx.action, s)) return;
        ctx.action = null;
      }

      const frame = ctx.frames[ctx.frames.length - 1];
      if (!frame) {
        ctx.done = true;
        return;
      }

      if (frame.index >= frame.body.length) {
        if (frame.loop?.op === 'forever') {
          if (frame.body.length === 0) {
            this.note = 'a forever block is empty';
            return;
          }
          // One tick per lap. Without this a loop of instant blocks would spin
          // the whole step budget away every single frame.
          frame.index = 0;
          return;
        }
        if (frame.loop?.op === 'repeat' && (frame.repeats ?? 0) > 1) {
          frame.repeats = (frame.repeats ?? 1) - 1;
          frame.index = 0;
          if (frame.body.length === 0) return;
          return;
        }
        ctx.frames.pop();
        continue;
      }

      const node = frame.body[frame.index++];
      this.currentNode = node;
      this.activeBlockId = node.id;
      this.tally(node.id);

      switch (node.op) {
        case 'forever':
          ctx.frames.push({ body: node.body ?? [], index: 0, loop: node });
          break;
        case 'repeat':
          ctx.frames.push({ body: node.body ?? [], index: 0, loop: node, repeats: Math.round(this.val(node, 'n', s)) });
          break;
        case 'if': {
          const yes = this.test(s, String(node.args.sensor), String(node.args.cmp), this.val(node, 'n', s));
          if (yes) {
            this.trueHits.set(node.id, (this.trueHits.get(node.id) ?? 0) + 1);
            ctx.frames.push({ body: node.body ?? [], index: 0 });
          }
          break;
        }
        case 'if_else': {
          const yes = this.test(s, String(node.args.sensor), String(node.args.cmp), this.val(node, 'n', s));
          if (yes) this.trueHits.set(node.id, (this.trueHits.get(node.id) ?? 0) + 1);
          ctx.frames.push({ body: (yes ? node.body : node.body2) ?? [], index: 0 });
          break;
        }
        case 'sweep':
        case 'turn_radar':
        case 'radar_start': {
          const ra = this.startAction(node, s);
          if (ra) {
            ctx.action = ra;
            this.applyChannels(ra);
            return;
          }
          break;
        }
        default: {
          const a = this.startAction(node, s);
          if (a) {
            ctx.action = a;
            this.applyChannels(a);
            return;
          }
        }
      }
    }
    this.note = 'script ran too long in one tick';
  }

  // ---------------------------------------------------------------- tick

  tick(dt: number, m: Match) {
    this.clock += dt;
    this.elapsed += dt;
    // Time is charged to whichever block is currently holding the bot, so a
    // long "drive forward 3s" shows up as the expensive thing it is.
    if (this.activeBlockId) {
      this.seconds.set(this.activeBlockId, (this.seconds.get(this.activeBlockId) ?? 0) + dt);
    }
    const s = this.senses(m);

    if (!this.base) {
      const start = this.hats('when_start')[0];
      if (start) this.base = this.startContext(start);
      else this.note = 'no "when the match starts" block';
    }

    this.checkHats(s);

    if (this.interrupt && !this.interrupt.done) {
      this.step(this.interrupt, s);
      if (this.interrupt.done) {
        this.interrupt = null;
        this.interruptPriority = -1;
      }
    } else if (this.base && !this.base.done) {
      this.step(this.base, s);
    } else {
      this.activeBlockId = null;
    }

    const ctx = this.interrupt && !this.interrupt.done ? this.interrupt : this.base;
    this.applyChannels(ctx?.action ?? null);

    // A gun that is hot cannot fire, so drop any request rather than queueing it.
    if (this.bot.gunHeat > 0 || this.bot.controls.fire < GUN.minPower) this.bot.controls.fire = 0;
  }
}
