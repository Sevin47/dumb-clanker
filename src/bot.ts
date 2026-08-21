import { World, Vec2, Box } from 'planck';
import type { Body } from 'planck';
import { BOT, BOT_COLORS, GUN } from './spec';

/**
 * The standard bot. Every competitor is mechanically identical — the hull, the
 * turret and the radar all turn independently, and the only difference between
 * one bot and the next is the Clank Script driving it.
 */

/** What hurt you. Four categories, because four is what a player can act on. */
export type DamageKind = 'shot' | 'wall' | 'ram' | 'other';

export const DAMAGE_KINDS: DamageKind[] = ['shot', 'wall', 'ram', 'other'];

export const DAMAGE_LABEL: Record<DamageKind, string> = {
  shot: 'shot',
  wall: 'walls',
  ram: 'ramming',
  other: 'other',
};

function deathText(kind: DamageKind, by: string): string {
  if (kind === 'wall') return 'drove into a wall';
  if (kind === 'shot') return by ? `shot by ${by}` : 'shot';
  if (kind === 'ram') return by ? `rammed by ${by}` : 'rammed';
  return by || 'unknown';
}

export interface Contact {
  /** The bot this reading is about. */
  id: number;
  /** Seconds since the radar last swept across them. */
  age: number;
  x: number;
  y: number;
  distance: number;
  /** Signed angle from the hull's nose, radians. Positive is to the right. */
  bearing: number;
  health: number;
  heading: number;
  speed: number;
  /**
   * How fast the gap was closing when the beam last crossed them, in metres per
   * second. Positive means coming at you. This is the pair's *relative* motion,
   * so it counts your own movement as well as theirs.
   */
  closing: number;
}

export interface Controls {
  /** -1 reverse .. +1 forward */
  throttle: number;
  /** -1 left .. +1 right */
  turn: number;
  /** Desired absolute turret heading, radians, or null to hold still. */
  turretTarget: number | null;
  /** Desired absolute radar heading, or null to hold still. */
  radarTarget: number | null;
  /** Constant radar spin: -1, 0 or +1. Overrides radarTarget when non-zero. */
  radarSpin: number;
  /** Power of a shot requested this tick, or 0 for none. */
  fire: number;
}

export const noControls = (): Controls => ({
  throttle: 0,
  turn: 0,
  turretTarget: null,
  radarTarget: null,
  radarSpin: 0,
  fire: 0,
});

export interface BotUserData {
  bot: Bot;
}

export class Bot {
  world: World;
  id: number;
  name: string;
  isPlayer: boolean;
  colors: (typeof BOT_COLORS)[number];

  body!: Body;

  /** Absolute headings in radians. All three move independently. */
  turret = 0;
  radar = 0;

  hp: number = BOT.hp;
  gunHeat: number = GUN.startHeat;
  alive = true;
  deathReason = '';
  /** 1 for the first bot knocked out, 2 for the second, and so on. */
  deathOrder = 0;
  /** Seconds into the battle when it died. Still -1 if it is alive. */
  deathAt = -1;

  controls: Controls = noControls();

  /** What the radar has seen, keyed by the bot it saw. */
  contacts = new Map<number, Contact>();
  /** The most recently scanned bot — what "the target" means in a script. */
  target: Contact | null = null;

  /** Flags the interpreter reads to fire its event hats. Cleared each tick. */
  eventShot = false;
  eventWall = false;
  eventBumped = false;
  eventScanned = false;

  /** Cosmetic only: rises as the bot is hurt, drives sparks and smoke. */
  damageFlash = 0;
  hitCooldown = 0;

  damageDealt = 0;
  shotsFired = 0;
  shotsHit = 0;

  /**
   * Where the damage came from. A health bar going down tells you that you are
   * losing; this tells you what is beating you, which is the part you can fix.
   */
  readonly damageBy: Record<DamageKind, number> = { shot: 0, wall: 0, ram: 0, other: 0 };

  /** Total taken, which is not the same as 140 minus health once you are dead. */
  damageTaken = 0;

  constructor(world: World, id: number, name: string, isPlayer: boolean, pos: Vec2, angle: number) {
    this.world = world;
    this.id = id;
    this.name = name;
    this.isPlayer = isPlayer;
    this.colors = BOT_COLORS[id % BOT_COLORS.length];

    this.body = world.createBody({
      type: 'dynamic',
      position: pos,
      angle,
      linearDamping: 0.8,
      angularDamping: 5.0,
      bullet: true,
    });
    this.body.createFixture({
      shape: Box(BOT.hx, BOT.hy),
      density: BOT.mass / (BOT.hx * 2 * BOT.hy * 2),
      friction: 0.35,
      restitution: 0.2,
      userData: { bot: this } as BotUserData,
    });

    this.turret = angle;
    this.radar = angle;
  }

  get position() {
    return this.body.getPosition();
  }

  get heading() {
    return this.body.getAngle();
  }

  get speed() {
    const v = this.body.getLinearVelocity();
    return Math.hypot(v.x, v.y);
  }

  get healthPct() {
    return Math.max(0, (this.hp / BOT.hp) * 100);
  }

  /** Where a bullet leaves the barrel. */
  muzzle() {
    const p = this.position;
    return { x: p.x + Math.cos(this.turret) * BOT.barrel, y: p.y + Math.sin(this.turret) * BOT.barrel };
  }

  // ---------------------------------------------------------------- step

  step(dt: number) {
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2);
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.gunHeat = Math.max(0, this.gunHeat - GUN.coolingRate * dt);
    for (const c of this.contacts.values()) c.age += dt;
    if (!this.alive) return;

    this.drive();
    this.turnTurret(dt);
    this.turnRadar(dt);
  }

  private drive() {
    const body = this.body;
    const forward = body.getWorldVector(Vec2(1, 0));
    const right = body.getWorldVector(Vec2(0, 1));
    const vel = body.getLinearVelocity();
    const fwdSpeed = Vec2.dot(vel, forward);
    const latSpeed = Vec2.dot(vel, right);
    const mass = body.getMass();

    const t = this.controls.throttle;
    if (t !== 0) {
      const underCap = t > 0 ? fwdSpeed < BOT.maxSpeed : fwdSpeed > -BOT.maxSpeed * BOT.reverseFactor;
      if (underCap) body.applyForceToCenter(Vec2.mul(forward, BOT.driveForce * t), true);
    }

    // Sideways grip, so the bot slides a little when thrown around.
    body.applyLinearImpulse(Vec2.mul(right, -latSpeed * mass * BOT.grip), body.getWorldCenter(), true);
    body.applyTorque(this.controls.turn * BOT.turnTorque, true);
  }

  /** Rotate a heading toward a target at a limited rate. */
  private slew(current: number, target: number, rate: number, dt: number): number {
    let d = target - current;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const step = rate * dt;
    if (Math.abs(d) <= step) return target;
    return current + Math.sign(d) * step;
  }

  private turnTurret(dt: number) {
    const want = this.controls.turretTarget;
    if (want === null) return;
    this.turret = this.slew(this.turret, want, BOT.turretTurnRate, dt);
  }

  private turnRadar(dt: number) {
    if (this.controls.radarSpin !== 0) {
      this.radar += this.controls.radarSpin * BOT.radarTurnRate * dt;
      return;
    }
    const want = this.controls.radarTarget;
    if (want === null) return;
    this.radar = this.slew(this.radar, want, BOT.radarTurnRate, dt);
  }

  // ---------------------------------------------------------------- damage

  hurt(amount: number, kind: DamageKind, by = '') {
    if (!this.alive || amount <= 0) return;
    this.hp -= amount;
    this.damageBy[kind] += amount;
    this.damageTaken += amount;
    this.damageFlash = Math.min(1, this.damageFlash + amount / 20);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deathReason = deathText(kind, by);
    }
  }

  /** The biggest single source of damage taken, for the standings and the bench. */
  worstDamage(): { kind: DamageKind; amount: number } {
    let kind: DamageKind = 'other';
    let amount = 0;
    for (const k of DAMAGE_KINDS) {
      if (this.damageBy[k] > amount) {
        amount = this.damageBy[k];
        kind = k;
      }
    }
    return { kind, amount };
  }

  /** Record a radar return. */
  see(other: Bot) {
    const p = this.position;
    const q = other.position;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    let bearing = Math.atan2(dy, dx) - this.heading;
    while (bearing > Math.PI) bearing -= Math.PI * 2;
    while (bearing < -Math.PI) bearing += Math.PI * 2;

    // Closing speed is the relative velocity projected onto the line between
    // the two bots. Worked out here, at the moment of the scan, because it is
    // only meaningful with both positions fresh.
    const range = Math.hypot(dx, dy);
    const mine = this.body.getLinearVelocity();
    const theirs = other.body.getLinearVelocity();
    const closing =
      range < 0.001 ? 0 : ((mine.x - theirs.x) * dx + (mine.y - theirs.y) * dy) / range;

    const contact: Contact = {
      id: other.id,
      age: 0,
      x: q.x,
      y: q.y,
      distance: range,
      bearing,
      health: other.healthPct,
      heading: other.heading,
      speed: other.speed,
      closing,
    };
    this.contacts.set(other.id, contact);
    this.target = contact;
    this.eventScanned = true;
  }

  /** Absolute world angle from this bot toward a remembered contact. */
  angleTo(c: Contact): number {
    const p = this.position;
    return Math.atan2(c.y - p.y, c.x - p.x);
  }
}
