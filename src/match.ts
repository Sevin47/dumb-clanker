import { World, Vec2, Box } from 'planck';
import { ARENA_SIZE, BOT, GUN, IMPACT, MATCH_SECONDS } from './spec';
import { P } from './palette';
import { Bot, type BotUserData } from './bot';
import type { Program } from './program';
import { ClankVM } from './vm';

export const ARENA_W = ARENA_SIZE;
export const ARENA_H = ARENA_SIZE;

const DT = 1 / 60;
const WALL = 0.6;
const MAX_PARTICLES = 340;

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  power: number;
  owner: Bot;
  dead: boolean;
}

export type MatchPhase = 'countdown' | 'fighting' | 'over';

export interface MatchResult {
  winner: Bot | null;
  reason: string;
  /** Finishing order, best first. */
  standings: Bot[];
}

export interface Entrant {
  name: string;
  program: Program;
  isPlayer: boolean;
}

export class Match {
  world: World;
  bots: Bot[] = [];
  vms = new Map<Bot, ClankVM>();
  bullets: Bullet[] = [];
  particles: Particle[] = [];
  shake = 0;
  timeLeft = MATCH_SECONDS;
  phase: MatchPhase = 'countdown';
  countdown = 2.4;
  result: MatchResult | null = null;
  slowmo = 0;

  private accumulator = 0;
  private deaths = 0;

  /**
   * Nothing is being drawn, so skip the work that only exists to be looked at.
   * Sparks, smoke, screen shake and the slow motion on a kill change nothing
   * about who wins, and the bench runs thousands of battles.
   */
  readonly headless: boolean;

  get player(): Bot {
    return this.bots.find((b) => b.isPlayer) ?? this.bots[0];
  }

  get alive(): Bot[] {
    return this.bots.filter((b) => b.alive);
  }

  constructor(entrants: Entrant[], opts: { headless?: boolean } = {}) {
    this.headless = opts.headless ?? false;
    this.world = new World(Vec2(0, 0));
    this.buildWalls();

    // Random placement, so no script can be tuned against a known opening.
    const spots = this.scatter(entrants.length);
    entrants.forEach((e, i) => {
      const bot = new Bot(this.world, i, e.name, e.isPlayer, spots[i], Math.random() * Math.PI * 2);
      this.bots.push(bot);
      this.vms.set(bot, new ClankVM(bot, e.program));
    });

    this.world.on('post-solve', (contact, impulse) => {
      const a = (contact.getFixtureA().getUserData() as BotUserData | null)?.bot;
      const b = (contact.getFixtureB().getUserData() as BotUserData | null)?.bot;
      let imp = 0;
      for (const v of impulse.normalImpulses) imp += v;

      if (a && b && a !== b) {
        if (a.hitCooldown > 0 || b.hitCooldown > 0) return;
        const speed = Math.max(a.speed, b.speed);
        const dmg = Math.max(IMPACT.ramMin, speed * IMPACT.ramPerSpeed);
        a.hitCooldown = IMPACT.cooldown;
        b.hitCooldown = IMPACT.cooldown;
        a.hurt(dmg, 'ram', b.name);
        b.hurt(dmg, 'ram', a.name);
        a.eventBumped = true;
        b.eventBumped = true;
        const p = a.position;
        this.sparks(p.x, p.y, 10, P.spark, 2);
        this.noteDeaths();
        return;
      }

      // One side of this contact is the wall.
      const bot = a ?? b;
      if (!bot || imp < 12 || bot.hitCooldown > 0) return;
      bot.eventWall = true;
      if (bot.speed > IMPACT.wallSafeSpeed) {
        bot.hitCooldown = IMPACT.cooldown;
        bot.hurt((bot.speed - IMPACT.wallSafeSpeed) * IMPACT.wallPerSpeed, 'wall');
        this.noteDeaths();
      }
    });
  }

  /**
   * Random start positions, kept off the walls and apart from each other.
   * Falls back to a ring if the arena is too crowded to place everyone.
   */
  private scatter(count: number): Vec2[] {
    const margin = 5;
    const minGap = 9;
    const span = ARENA_SIZE - margin * 2;
    const out: Vec2[] = [];

    for (let i = 0; i < count; i++) {
      let placed: Vec2 | null = null;
      for (let tries = 0; tries < 300 && !placed; tries++) {
        const p = Vec2(margin + Math.random() * span, margin + Math.random() * span);
        if (out.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= minGap)) placed = p;
      }
      if (!placed) {
        const a = (i / count) * Math.PI * 2;
        placed = Vec2(
          ARENA_W / 2 + Math.cos(a) * span * 0.4,
          ARENA_H / 2 + Math.sin(a) * span * 0.4,
        );
      }
      out.push(placed);
    }
    return out;
  }

  /**
   * Put the player's bot back in play. It is a debugging tool: a script that
   * has wedged itself in a corner or talked itself into a corner of its own
   * logic can be freed without throwing away the whole battle.
   */
  recallPlayer() {
    const bot = this.player;
    if (!bot || !bot.alive || this.phase === 'over') return;

    const taken = this.bots.filter((b) => b !== bot && b.alive).map((b) => b.position);
    let spot = Vec2(ARENA_W / 2, ARENA_H / 2);
    for (let tries = 0; tries < 300; tries++) {
      const p = Vec2(5 + Math.random() * (ARENA_SIZE - 10), 5 + Math.random() * (ARENA_SIZE - 10));
      if (taken.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= 10)) {
        spot = p;
        break;
      }
    }

    const from = bot.position;
    this.sparks(from.x, from.y, 24, P.spark, 2.5);
    bot.body.setTransform(spot, Math.random() * Math.PI * 2);
    bot.body.setLinearVelocity(Vec2(0, 0));
    bot.body.setAngularVelocity(0);
    bot.turret = bot.body.getAngle();
    bot.radar = bot.body.getAngle();
    // No free shot out of a recall.
    bot.gunHeat = Math.max(bot.gunHeat, GUN.startHeat);
    bot.contacts.clear();
    bot.target = null;
    this.vms.get(bot)?.restart();
    this.sparks(spot.x, spot.y, 24, P.good, 2.5);
    this.recalls++;
  }

  recalls = 0;

  private buildWalls() {
    const w = this.world.createBody({ type: 'static' });
    const add = (hx: number, hy: number, cx: number, cy: number) =>
      w.createFixture({ shape: Box(hx, hy, Vec2(cx, cy)), friction: 0.25, restitution: 0.3 });
    add(ARENA_W / 2 + WALL, WALL, ARENA_W / 2, -WALL);
    add(ARENA_W / 2 + WALL, WALL, ARENA_W / 2, ARENA_H + WALL);
    add(WALL, ARENA_H / 2 + WALL, -WALL, ARENA_H / 2);
    add(WALL, ARENA_H / 2 + WALL, ARENA_W + WALL, ARENA_H / 2);
  }

  /** Stamp a finishing position on anything that has just died, then clear it away. */
  private noteDeaths() {
    for (const b of this.bots) {
      if (b.alive || b.deathOrder !== 0) continue;
      b.deathOrder = ++this.deaths;
      b.deathAt = MATCH_SECONDS - this.timeLeft;
      const p = b.position;
      this.sparks(p.x, p.y, 46, P.hot, 5);
      this.slowmo = 0.9;

      // Take the wreck out of the world. Leaving it in means survivors bounce
      // off a corpse and take ramming damage from a bot that is already beaten.
      // The body object stays so its last position can still be read; it just
      // stops taking part in the simulation.
      this.world.queueUpdate(() => b.body.setActive(false));
    }
  }

  // ---------------------------------------------------------------- effects

  sparks(x: number, y: number, count: number, color: string, power = 1) {
    if (this.headless) return;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const a = Math.random() * Math.PI * 2;
      const s = (0.6 + Math.random() * 2.4) * power;
      const life = 0.18 + Math.random() * 0.45;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        maxLife: life,
        color,
        size: Math.random() < 0.25 ? 2 : 1,
      });
    }
  }

  // ---------------------------------------------------------------- guns

  private tryFire(bot: Bot) {
    const power = Math.max(0, Math.min(GUN.maxPower, bot.controls.fire));
    bot.controls.fire = 0;
    if (power < GUN.minPower || bot.gunHeat > 0 || !bot.alive) return;

    bot.gunHeat = GUN.heat(power);
    bot.shotsFired++;
    const m = bot.muzzle();
    const speed = GUN.speed(power);
    this.bullets.push({
      x: m.x,
      y: m.y,
      vx: Math.cos(bot.turret) * speed,
      vy: Math.sin(bot.turret) * speed,
      power,
      owner: bot,
      dead: false,
    });
    this.sparks(m.x, m.y, 5, P.spark, 1.6 * power);
    this.shake = Math.min(8, this.shake + power * 0.4);
  }

  private stepBullets(dt: number) {
    for (const b of this.bullets) {
      if (b.dead) continue;
      // Sub-step, or a fast round can tunnel straight through a hull.
      const steps = 3;
      for (let s = 0; s < steps && !b.dead; s++) {
        b.x += (b.vx * dt) / steps;
        b.y += (b.vy * dt) / steps;

        if (b.x < 0 || b.x > ARENA_W || b.y < 0 || b.y > ARENA_H) {
          b.dead = true;
          this.sparks(
            Math.max(0, Math.min(ARENA_W, b.x)),
            Math.max(0, Math.min(ARENA_H, b.y)),
            4,
            P.steelLight,
            1.2,
          );
          break;
        }

        for (const bot of this.bots) {
          if (!bot.alive || bot === b.owner) continue;
          const f = bot.body.getFixtureList();
          if (!f || !f.testPoint(Vec2(b.x, b.y))) continue;
          b.dead = true;
          const dmg = GUN.damage(b.power);
          bot.hurt(dmg, 'shot', b.owner.name);
          bot.eventShot = true;
          b.owner.damageDealt += dmg;
          b.owner.shotsHit++;
          this.sparks(b.x, b.y, 12 + Math.round(b.power * 6), P.hot, 2 + b.power);
          this.shake = Math.min(9, this.shake + b.power);
          this.noteDeaths();
          break;
        }
      }
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
  }

  // ---------------------------------------------------------------- radar

  /**
   * A radar is a narrow beam, not an all-round sensor. It only reports a bot
   * when the beam actually sweeps across it, which is why a script has to keep
   * the radar moving — and why holding it on someone is a real skill.
   */
  private sweepRadar(bot: Bot, prevRadar: number) {
    if (!bot.alive) return;
    const half = (BOT.radarArc * Math.PI) / 360;
    const p = bot.position;

    for (const other of this.bots) {
      if (other === bot || !other.alive) continue;
      const q = other.position;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d > BOT.radarRange) continue;

      const angle = Math.atan2(q.y - p.y, q.x - p.x);
      if (within(angle, bot.radar, half) || crossed(prevRadar, bot.radar, angle, half)) {
        bot.see(other);
      }
    }
  }

  // ---------------------------------------------------------------- loop

  update(dt: number) {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.phase = 'fighting';
    }

    if (this.slowmo > 0) this.slowmo = Math.max(0, this.slowmo - dt);
    const scale = this.slowmo > 0 && !this.headless ? 0.3 : 1;

    this.accumulator += Math.min(dt, 0.1) * scale;
    while (this.accumulator >= DT) {
      this.accumulator -= DT;
      this.fixedStep();
    }

    if (this.headless) return;

    this.shake = Math.max(0, this.shake - dt * 20);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
    }
  }

  private fixedStep() {
    const live = this.phase === 'fighting';

    for (const bot of this.bots) {
      if (live && bot.alive) {
        this.vms.get(bot)!.tick(DT, this);
      } else {
        bot.controls.throttle = 0;
        bot.controls.turn = 0;
        bot.controls.fire = 0;
        bot.controls.radarSpin = 0;
      }
    }

    for (const bot of this.bots) {
      const prevRadar = bot.radar;
      bot.step(DT);
      if (live) {
        this.sweepRadar(bot, prevRadar);
        this.tryFire(bot);
      }
    }

    this.world.step(DT, 8, 3);
    if (live) this.stepBullets(DT);

    // Smoke from anything badly hurt.
    for (const bot of this.bots) {
      if (!bot.alive || bot.healthPct > 45) continue;
      if (Math.random() < 0.12) {
        const p = bot.position;
        this.sparks(p.x, p.y, 1, bot.healthPct < 20 ? P.hot : P.steelDark, 0.5);
      }
    }

    if (live) {
      this.timeLeft = Math.max(0, this.timeLeft - DT);
      this.checkEnd();
    }
  }

  private checkEnd() {
    if (this.phase === 'over') return;
    this.noteDeaths();
    const alive = this.alive;
    if (alive.length > 1 && this.timeLeft > 0) return;

    const standings = [...this.bots].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (a.alive && b.alive) return b.hp - a.hp;
      return b.deathOrder - a.deathOrder;
    });
    const winner = standings[0]?.alive ? standings[0] : null;
    const reason =
      this.timeLeft <= 0
        ? 'time ran out'
        : winner
          ? winner.isPlayer
            ? 'you are the last one moving'
            : `${winner.name} is the last one moving`
          : 'everyone is scrap';
    this.result = { winner, reason, standings };
    this.phase = 'over';
  }
}

function within(angle: number, centre: number, half: number) {
  let d = angle - centre;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= half;
}

/** Did a beam sweeping from `from` to `to` pass over `angle` this tick? */
function crossed(from: number, to: number, angle: number, half: number) {
  let sweep = to - from;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  if (Math.abs(sweep) < 1e-4) return false;
  let rel = angle - from;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  return sweep > 0 ? rel >= -half && rel <= sweep + half : rel <= half && rel >= sweep - half;
}
