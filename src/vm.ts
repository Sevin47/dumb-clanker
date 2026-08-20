import { BLOCK_BY_OP } from './blocks';
import type { Node, Program, Stack } from './program';
import type { Bot } from './bot';
import type { Match } from './match';
import { ARENA_W, ARENA_H } from './match';
import { GUN } from './spec';

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
  /** For the manual turn blocks: radians still owed. */
  owed?: number;
  last?: number;
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

  constructor(
    private bot: Bot,
    private program: Program,
  ) {}

  private hats(op: string): Stack[] {
    return this.program.stacks.filter((s) => s.hat.op === op);
  }

  private startContext(stack: Stack): Context {
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
        // A negative amount flips the direction, which is how a signed sensor
        // steers a turn without needing any arithmetic blocks.
        const amount = clampTurn(this.val(node, 'n', s));
        const sign = (String(node.args.dir) === 'left' ? -1 : 1) * (amount < 0 ? -1 : 1);
        return {
          op,
          dir: sign < 0 ? 'left' : 'right',
          owed: (Math.abs(amount) * Math.PI) / 180,
          last: b.heading,
          endsAt: this.clock + 5,
          deadline: this.clock + 5,
        };
      }

      // --- turret channel ---
      case 'turn_turret': {
        const amount = clampTurn(this.val(node, 'n', s));
        const sign = String(node.args.dir) === 'left' ? -1 : 1;
        this.turretTarget = b.turret + (sign * amount * Math.PI) / 180;
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
      case 'turn_radar': {
        const amount = clampTurn(this.val(node, 'n', s));
        const sign = String(node.args.dir) === 'left' ? -1 : 1;
        this.radarSpin = 0;
        this.radarTarget = b.radar + (sign * amount * Math.PI) / 180;
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
        return s.target_bearing < 9 || this.clock >= a.endsAt;
      case 'turn_body':
      case 'turn_radar': {
        const now = a.op === 'turn_body' ? b.heading : b.radar;
        const d = wrap(now - (a.last ?? now));
        a.last = now;
        a.owed = (a.owed ?? 0) - Math.abs(d);
        if (a.op === 'turn_radar') return b.radar === this.radarTarget || this.clock >= a.endsAt;
        return (a.owed ?? 0) <= 0 || this.clock >= a.endsAt;
      }
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
          this.turn = toward(relBearing);
          break;
        case 'stop':
          this.throttle = 0;
          this.turn = 0;
          break;
        case 'turn_body':
          this.throttle = 0;
          this.turn = a.dir === 'left' ? -1 : 1;
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

      switch (node.op) {
        case 'forever':
          ctx.frames.push({ body: node.body ?? [], index: 0, loop: node });
          break;
        case 'repeat':
          ctx.frames.push({ body: node.body ?? [], index: 0, loop: node, repeats: Math.round(this.val(node, 'n', s)) });
          break;
        case 'if':
          if (this.test(s, String(node.args.sensor), String(node.args.cmp), this.val(node, 'n', s))) {
            ctx.frames.push({ body: node.body ?? [], index: 0 });
          }
          break;
        case 'if_else':
          ctx.frames.push({
            body:
              (this.test(s, String(node.args.sensor), String(node.args.cmp), this.val(node, 'n', s))
                ? node.body
                : node.body2) ?? [],
            index: 0,
          });
          break;
        case 'sweep':
        case 'turn_radar': {
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
