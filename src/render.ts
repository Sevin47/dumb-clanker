import * as T from 'three';
import { HUD_W, VIEW_H, VIEW_W } from './config';
import { P } from './palette';
import type { Bot } from './bot';
import type { Bullet, Match, Particle } from './match';
import { ARENA_H, ARENA_W } from './match';
import { BOT } from './spec';
import { Hud } from './hud';

/**
 * Physics is 2D (the arena floor is flat), so 3D is purely presentation:
 * physics (x, y) maps to world (x, z) and an angle becomes a spin about Y.
 * The scene renders to a 480x270 buffer and is upscaled with no smoothing,
 * which keeps the chunky pixel look; the HUD is drawn separately at full
 * resolution so the text stays sharp.
 */

const HULL_H = 0.5;
const HULL_Y = 0.3;
const WALL_H = 1.6;

const col = (hex: string) => new T.Color(hex);

function boxMesh(w: number, h: number, d: number, color: string) {
  return new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshLambertMaterial({ color: col(color) }));
}

/** Keeps the radar wedges inside the arena instead of spilling over the edge. */
const ARENA_CLIP = [
  new T.Plane(new T.Vector3(1, 0, 0), 0),
  new T.Plane(new T.Vector3(-1, 0, 0), ARENA_W),
  new T.Plane(new T.Vector3(0, 0, 1), 0),
  new T.Plane(new T.Vector3(0, 0, -1), ARENA_H),
];

/** Meshes for one bot: hull, turret and radar all pointing independently. */
class BotView {
  group = new T.Group();
  private turretGroup = new T.Group();
  private radarGroup = new T.Group();
  private hull: T.Mesh;
  private barrel: T.Mesh;
  private beam: T.Mesh;

  constructor(
    private bot: Bot,
    private scene: T.Scene,
  ) {
    const c = bot.colors;

    this.hull = boxMesh(BOT.hx * 2, HULL_H, BOT.hy * 2, c.body);
    this.hull.position.y = HULL_Y;
    this.group.add(this.hull);

    // Nose flash so the hull's facing is obvious even when the gun points away.
    const nose = boxMesh(0.14, HULL_H * 0.7, BOT.hy * 1.4, c.light);
    nose.position.set(BOT.hx - 0.07, HULL_Y + 0.05, 0);
    this.group.add(nose);

    for (const s of [-1, 1]) {
      const tread = boxMesh(BOT.hx * 1.7, 0.26, 0.22, P.rubber);
      tread.position.set(0, 0.13, s * (BOT.hy + 0.08));
      this.group.add(tread);
    }

    // Turret: its own group so it can face wherever the script points it.
    const dome = boxMesh(0.7, 0.34, 0.7, c.dark);
    dome.position.y = HULL_Y + HULL_H / 2 + 0.16;
    this.turretGroup.add(dome);
    this.barrel = boxMesh(BOT.barrel, 0.18, 0.2, P.steel);
    this.barrel.position.set(BOT.barrel / 2, HULL_Y + HULL_H / 2 + 0.16, 0);
    this.turretGroup.add(this.barrel);
    scene.add(this.turretGroup);

    // Radar: a translucent wedge showing exactly where the beam is looking.
    //
    // The wedge is only tipped flat here. Steering happens on the parent group,
    // about Y, exactly like the hull and turret. Rotating the mesh itself about
    // Z instead draws the beam mirrored, because tipping it flat afterwards
    // flips the in-plane angle — which makes a bot look like it is shooting at
    // things its radar never saw.
    const arc = (BOT.radarArc * Math.PI) / 180;
    const geo = new T.CircleGeometry(BOT.radarRange, 20, -arc / 2, arc);
    this.beam = new T.Mesh(
      geo,
      new T.MeshBasicMaterial({
        color: col(c.light),
        transparent: true,
        opacity: bot.isPlayer ? 0.22 : 0.09,
        side: T.DoubleSide,
        depthWrite: false,
        clippingPlanes: ARENA_CLIP,
      }),
    );
    this.beam.rotation.x = -Math.PI / 2;
    this.radarGroup.add(this.beam);
    scene.add(this.radarGroup);

    scene.add(this.group);
  }

  sync() {
    const b = this.bot;
    const p = b.position;

    this.group.visible = true;
    this.group.position.set(p.x, b.alive ? 0 : -0.18, p.y);
    this.group.rotation.y = -b.heading;

    const mat = this.hull.material as T.MeshLambertMaterial;
    if (b.damageFlash > 0.02) mat.color.set(P.steelLight);
    else if (!b.alive) mat.color.set(P.wallDark);
    else {
      // Scorch the paint as the bot gets hurt. Purely cosmetic.
      const hurt = 1 - b.healthPct / 100;
      mat.color.set(col(b.colors.body).lerp(col('#241d22'), hurt * 0.65));
    }

    this.turretGroup.visible = b.alive;
    this.turretGroup.position.set(p.x, 0, p.y);
    this.turretGroup.rotation.y = -b.turret;

    // Everyone's beam is drawn, so you can see what they can see.
    this.radarGroup.visible = b.alive;
    this.radarGroup.position.set(p.x, b.isPlayer ? 0.09 : 0.05, p.y);
    this.radarGroup.rotation.y = -b.radar;
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.turretGroup);
    this.scene.remove(this.radarGroup);
  }
}

export class Renderer {
  readonly buf: HTMLCanvasElement;
  private bx: CanvasRenderingContext2D;
  private out: CanvasRenderingContext2D;

  private three: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera: T.OrthographicCamera;
  private hud: Hud;

  private views = new Map<Bot, BotView>();
  private bulletMeshes: T.Mesh[] = [];
  private points: T.Points;
  private pointPos: Float32Array;
  private pointCol: Float32Array;

  private lastMatch: Match | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.buf = document.createElement('canvas');
    this.buf.width = VIEW_W;
    this.buf.height = VIEW_H;
    this.bx = this.buf.getContext('2d')!;
    this.out = canvas.getContext('2d')!;
    this.hud = new Hud(this.out);

    // Straight down, orthographic, whole field always visible — the Robocode
    // view. Nobody is driving, so the job of the shot is to show the geometry
    // of the fight, not to look cinematic.
    const margin = 2.5;
    const halfH = ARENA_H / 2 + margin;
    const halfW = halfH * (VIEW_W / VIEW_H);
    this.camera = new T.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 200);
    this.camera.position.set(ARENA_W / 2, 60, ARENA_H / 2);
    // Point "up" on screen at -z, so physics +y runs down the screen.
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(ARENA_W / 2, 0, ARENA_H / 2);

    const gl = document.createElement('canvas');
    gl.width = VIEW_W;
    gl.height = VIEW_H;
    this.three = new T.WebGLRenderer({ canvas: gl, antialias: false, preserveDrawingBuffer: true });
    this.three.setPixelRatio(1);
    this.three.setSize(VIEW_W, VIEW_H, false);
    this.three.localClippingEnabled = true;
    this.scene.background = col(P.backdrop);
    this.scene.fog = new T.Fog(col(P.backdrop), 46, 110);

    // Three's light intensities are physical: much past 1.0 in total and the
    // palette washes out to pastel.
    this.scene.add(new T.AmbientLight(0xffffff, 0.55));
    const key = new T.DirectionalLight(0xffffff, 0.8);
    key.position.set(-0.4, 1, 0.55);
    this.scene.add(key);
    const rim = new T.DirectionalLight(col(P.wallLit), 0.22);
    rim.position.set(0.6, 0.3, -0.8);
    this.scene.add(rim);

    this.buildArena();

    const MAXP = 360;
    this.pointPos = new Float32Array(MAXP * 3);
    this.pointCol = new Float32Array(MAXP * 3);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(this.pointPos, 3));
    g.setAttribute('color', new T.BufferAttribute(this.pointCol, 3));
    this.points = new T.Points(g, new T.PointsMaterial({ size: 0.3, vertexColors: true, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  private buildArena() {
    const tc = document.createElement('canvas');
    tc.width = tc.height = 32;
    const t2 = tc.getContext('2d')!;
    t2.fillStyle = P.floor;
    t2.fillRect(0, 0, 32, 32);
    t2.fillStyle = P.floorAlt;
    t2.fillRect(0, 0, 16, 16);
    t2.fillRect(16, 16, 16, 16);
    t2.fillStyle = P.grid;
    t2.fillRect(0, 0, 32, 1);
    t2.fillRect(0, 0, 1, 32);
    const tex = new T.CanvasTexture(tc);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.magFilter = T.NearestFilter;
    tex.minFilter = T.NearestFilter;
    tex.repeat.set(ARENA_W / 2, ARENA_H / 2);

    const floor = new T.Mesh(new T.PlaneGeometry(ARENA_W, ARENA_H), new T.MeshLambertMaterial({ map: tex }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(ARENA_W / 2, 0, ARENA_H / 2);
    this.scene.add(floor);

    const outer = new T.Mesh(new T.PlaneGeometry(220, 220), new T.MeshLambertMaterial({ color: col(P.wallDark) }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(ARENA_W / 2, -0.4, ARENA_H / 2);
    this.scene.add(outer);

    const wallMat = new T.MeshLambertMaterial({ color: col(P.wall) });
    const railMat = new T.MeshLambertMaterial({ color: col(P.wallLit) });
    const wall = (w: number, d: number, x: number, z: number) => {
      const m = new T.Mesh(new T.BoxGeometry(w, WALL_H, d), wallMat);
      m.position.set(x, WALL_H / 2, z);
      this.scene.add(m);
      const r = new T.Mesh(new T.BoxGeometry(w, 0.12, d + 0.06), railMat);
      r.position.set(x, WALL_H, z);
      this.scene.add(r);
    };
    wall(ARENA_W + 1.2, 0.6, ARENA_W / 2, -0.3);
    wall(ARENA_W + 1.2, 0.6, ARENA_W / 2, ARENA_H + 0.3);
    wall(0.6, ARENA_H + 1.2, -0.3, ARENA_H / 2);
    wall(0.6, ARENA_H + 1.2, ARENA_W + 0.3, ARENA_H / 2);
  }

  resize() {
    // Whole integer scales only, so the pixels stay square. CSS caps the element
    // at the viewport, which letterboxes the rare case where a scale overflows
    // by a hair rather than dropping the whole game down a step.
    const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H)));
    this.canvas.width = VIEW_W * scale;
    this.canvas.height = VIEW_H * scale;
    this.canvas.style.width = `${VIEW_W * scale}px`;
    this.canvas.style.height = `${VIEW_H * scale}px`;
    this.out.imageSmoothingEnabled = false;
  }

  private attach(m: Match) {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    for (const b of m.bots) this.views.set(b, new BotView(b, this.scene));
    this.lastMatch = m;
  }

  private syncBullets(list: Bullet[]) {
    while (this.bulletMeshes.length < list.length) {
      const m = new T.Mesh(
        new T.SphereGeometry(0.13, 6, 5),
        new T.MeshBasicMaterial({ color: col(P.spark) }),
      );
      this.scene.add(m);
      this.bulletMeshes.push(m);
    }
    this.bulletMeshes.forEach((mesh, i) => {
      const b = list[i];
      mesh.visible = !!b;
      if (!b) return;
      mesh.position.set(b.x, 0.55, b.y);
      mesh.scale.setScalar(0.7 + b.power * 0.35);
    });
  }

  private syncParticles(list: Particle[]) {
    const n = Math.min(list.length, this.pointPos.length / 3);
    const c = new T.Color();
    for (let i = 0; i < n; i++) {
      const p = list[i];
      this.pointPos[i * 3] = p.x;
      this.pointPos[i * 3 + 1] = 0.45 + (1 - p.life / p.maxLife) * 0.35;
      this.pointPos[i * 3 + 2] = p.y;
      c.set(p.color);
      this.pointCol[i * 3] = c.r;
      this.pointCol[i * 3 + 1] = c.g;
      this.pointCol[i * 3 + 2] = c.b;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    (g.getAttribute('position') as T.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as T.BufferAttribute).needsUpdate = true;
  }

  draw(m: Match, dt = 1 / 60) {
    if (this.lastMatch !== m) this.attach(m);

    void dt;
    for (const v of this.views.values()) v.sync();
    this.syncBullets(m.bullets);
    this.syncParticles(m.particles);

    // A fixed camera can still flinch when something explodes.
    const kick = m.shake > 0.2 ? m.shake * 0.02 : 0;
    this.camera.position.set(
      ARENA_W / 2 + (Math.random() - 0.5) * kick,
      60,
      ARENA_H / 2 + (Math.random() - 0.5) * kick,
    );
    this.camera.lookAt(this.camera.position.x, 0, this.camera.position.z);

    this.three.render(this.scene, this.camera);

    this.bx.imageSmoothingEnabled = false;
    this.bx.clearRect(0, 0, VIEW_W, VIEW_H);
    this.bx.drawImage(this.three.domElement, 0, 0);

    this.out.imageSmoothingEnabled = false;
    this.out.drawImage(this.buf, 0, 0, this.canvas.width, this.canvas.height);

    const scale = this.canvas.width / HUD_W;
    this.out.save();
    this.out.setTransform(scale, 0, 0, scale, 0, 0);
    this.out.imageSmoothingEnabled = true;
    this.hud.draw(m);
    this.out.restore();
  }
}
