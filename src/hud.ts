import { HUD_H, HUD_W } from './config';
import { P } from './palette';
import type { Match } from './match';
import { GUN } from './spec';

const FONT = 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Flat overlay drawn on top of the 3D scene. It is drawn into a context scaled
 * up to the real canvas size, so sizes here are in the 480x270 layout space but
 * render at full device resolution — which is what lets the HUD use a readable
 * sans instead of a tiny monospace.
 */
export class Hud {
  /**
   * Layout size. A phone gets a smaller grid so the same numbers come out
   * physically bigger, otherwise the readouts land at about eight pixels tall.
   */
  private w = HUD_W;
  private h = HUD_H;

  constructor(private c: CanvasRenderingContext2D) {}

  setLayout(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  text(
    s: string,
    x: number,
    y: number,
    color: string,
    size = 9,
    weight: 400 | 600 | 700 = 600,
    align: CanvasTextAlign = 'left',
  ) {
    const c = this.c;
    c.font = `${weight} ${size}px ${FONT}`;
    c.textAlign = align;
    c.fillStyle = color;
    c.fillText(s, x, y);
  }

  private bar(x: number, y: number, w: number, h: number, frac: number, fill: string, back = P.ink) {
    const c = this.c;
    c.fillStyle = back;
    c.fillRect(x, y, w, h);
    c.fillStyle = fill;
    c.fillRect(x, y, Math.max(0, w * Math.max(0, Math.min(1, frac))), h);
  }

  draw(m: Match) {
    this.c.textBaseline = 'top';
    this.topBar(m);
    this.roster(m);
    if (m.phase === 'countdown') this.countdown(m);
    if (m.phase === 'over') this.result(m);
    this.c.textAlign = 'left';
  }

  private topBar(m: Match) {
    const c = this.c;
    c.fillStyle = P.ink;
    c.fillRect(0, 0, this.w, 40);
    c.fillStyle = P.line;
    c.fillRect(0, 40, this.w, 1);

    const me = m.player;
    this.text('YOUR BOT', 8, 5, me.colors.light, 11, 700);
    this.bar(8, 20, 150, 5, me.healthPct / 100, me.healthPct < 30 ? P.danger : me.colors.body);
    this.text(`${Math.round(me.healthPct)}%`, 164, 18, P.text, 10, 700);

    // Gun heat is the one number a script writer watches constantly.
    const heat = Math.min(1, me.gunHeat / GUN.heat(GUN.maxPower));
    this.text('GUN', 8, 29, P.textDim, 8, 600);
    this.bar(30, 30, 128, 3, heat, heat > 0 ? P.hot : P.good);
    if (me.gunHeat <= 0) this.text('READY', 164, 28, P.good, 8, 700);

    const t = Math.max(0, Math.ceil(m.timeLeft));
    const label = `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
    this.text(label, this.w / 2, 6, t <= 10 ? P.danger : P.text, 17, 700, 'center');
    const n = m.alive.length;
    this.text(`${n} BOT${n === 1 ? '' : 'S'} LEFT`, this.w / 2, 27, P.textDim, 8, 600, 'center');
    c.textAlign = 'left';
  }

  /** Every bot in the battle, so a melee stays readable. */
  private roster(m: Match) {
    const c = this.c;
    const x = this.w - 116;
    let y = 48;
    this.text('FIELD', this.w - 8, y, P.textDim, 8, 700, 'right');
    y += 12;

    for (const bot of m.bots) {
      const dead = !bot.alive;
      c.fillStyle = dead ? P.pipOff : bot.colors.body;
      c.fillRect(x, y + 1, 6, 6);

      this.text(
        bot.name,
        x + 11,
        y,
        dead ? P.muted : bot.isPlayer ? bot.colors.light : P.text,
        9,
        bot.isPlayer ? 700 : 600,
      );
      this.bar(x + 11, y + 10, 97, 3, bot.healthPct / 100, dead ? P.pipOff : bot.colors.body);
      y += 18;
    }
  }

  private countdown(m: Match) {
    const n = Math.ceil(m.countdown - 0.5);
    const label = n > 0 ? String(n) : 'FIGHT';
    this.text(label, this.w / 2, this.h / 2 - 18, n > 0 ? P.text : P.spark, 34, 700, 'center');
  }

  private result(m: Match) {
    const c = this.c;
    const r = m.result;
    if (!r) return;

    const rows = r.standings.length;
    const h = 96 + rows * 15;
    const w = 300;
    const x = (this.w - w) / 2;
    const y = (this.h - h) / 2 + 8;

    c.globalAlpha = 0.9;
    c.fillStyle = P.ink;
    c.fillRect(x, y, w, h);
    c.globalAlpha = 1;
    c.fillStyle = P.line;
    c.fillRect(x, y, w, 1);
    c.fillRect(x, y + h - 1, w, 1);

    const won = r.winner === m.player;
    const title = !r.winner ? 'NOBODY WINS' : won ? 'YOU WIN' : `${r.winner.name.toUpperCase()} WINS`;
    this.text(title, this.w / 2, y + 12, !r.winner ? P.text : won ? P.good : P.danger, 22, 700, 'center');
    this.text(r.reason, this.w / 2, y + 40, P.textDim, 10, 600, 'center');

    let ry = y + 60;
    this.text('BOT', x + 16, ry, P.textDim, 8, 700);
    this.text('DAMAGE', x + w - 96, ry, P.textDim, 8, 700, 'right');
    this.text('ACCURACY', x + w - 16, ry, P.textDim, 8, 700, 'right');
    ry += 14;

    r.standings.forEach((bot, i) => {
      const acc = bot.shotsFired > 0 ? Math.round((bot.shotsHit / bot.shotsFired) * 100) : 0;
      const tint = bot.isPlayer ? bot.colors.light : bot.alive ? P.text : P.muted;
      c.fillStyle = bot.colors.body;
      c.fillRect(x + 16, ry + 2, 5, 5);
      this.text(`${i + 1}. ${bot.name}`, x + 26, ry, tint, 10, bot.isPlayer ? 700 : 400);
      this.text(String(Math.round(bot.damageDealt)), x + w - 96, ry, tint, 10, 600, 'right');
      this.text(`${acc}%`, x + w - 16, ry, tint, 10, 600, 'right');
      ry += 15;
    });

    this.text('R  run it again          B  back to the workshop', this.w / 2, y + h - 20, P.spark, 10, 600, 'center');
  }
}
