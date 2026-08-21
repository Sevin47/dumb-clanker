import { audioEnabled, toggleAudio } from './audio';
import { SENSORS } from './blocks';
import { ScriptEditor } from './editor';
import type { Match } from './match';
import type { Node } from './program';
import type { ClankVM } from './vm';

/**
 * The debug console that sits beside the arena.
 *
 * It shows the player's script exactly as they wrote it, highlights the block
 * currently running, and keeps a running tally of how often each block fires
 * and how much of the battle it occupies. A block that never lights up is
 * usually the bug — an event that never fires, or a branch whose test is never
 * true — and that is invisible from watching the bots alone.
 *
 * The script markup is built once per battle. Only classes and a few numbers
 * change per frame, because re-rendering a whole script at 60fps would cost
 * more than the game does.
 */

export interface Transport {
  paused: boolean;
  speed: number;
  /** Set to advance a single frame while paused. */
  stepOnce: boolean;
}

const SPEEDS = [0.5, 1, 2, 4];

const CHANNELS = ['driving', 'turret', 'radar'];

const deg = (r: number) => (r * 180) / Math.PI;

/** Trim a heading difference to the short way round. */
function wrapDeg(d: number): number {
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/**
 * How each sensor reads on screen. The unit decides the precision: a distance
 * to a tenth of a metre is useful, a heading to a tenth of a degree is noise.
 */
function formatSense(id: string, unit: string, v: number): string {
  // 999 is the "I have never scanned anybody" sentinel. Printing it as a real
  // distance invites people to compare against it, which is not the idea.
  if ((id === 'target_distance' || id === 'target_age') && v >= 999) return 'nobody';
  switch (unit) {
    case 'angle':
      return `${Math.round(v)}°`;
    case 'percent':
      return `${Math.round(v)}%`;
    case 'time':
      return `${v.toFixed(1)}s`;
    case 'distance':
      return `${v.toFixed(1)}m`;
    case 'speed':
      return `${v.toFixed(1)}m/s`;
    case 'count':
      return String(Math.round(v));
    default:
      return v.toFixed(1);
  }
}

export class Inspector {
  private root: HTMLElement;
  private scriptHost: HTMLElement;
  private statusEl: HTMLElement;
  private noteEl: HTMLElement;

  private builtFor: ClankVM | null = null;
  private lastLive: string | null = null;
  private nodes = new Map<string, HTMLElement>();
  private profs = new Map<string, HTMLElement>();
  private statsAt = 0;

  /** Live readouts. Built once, then only their text changes. */
  private senseCells = new Map<string, HTMLElement>();
  private chanCells = new Map<string, HTMLElement>();
  /** The "if" blocks in this battle's script, so a branch that never fires shows. */
  private conditionIds = new Set<string>();

  transport: Transport = { paused: false, speed: 1, stepOnce: false };

  constructor(
    root: HTMLElement,
    private onRecall: () => void,
    private onRerun: () => void,
    private onWorkshop: () => void,
    private onHide: () => void,
  ) {
    this.root = root;
    this.root.innerHTML = `
      <header class="ins-head">
        <h2>Your script</h2>
        <span class="ins-status" id="ins-status">waiting</span>
        <button id="ins-hide" title="Hide this panel and just watch. Shortcut: I">Hide</button>
      </header>
      <div class="ins-script" id="ins-script"></div>
      <p class="ins-note" id="ins-note"></p>
      <div class="ins-chan">
        ${CHANNELS.map(
          (k) => `<div class="chan"><span class="chan-k">${k}</span>
            <span class="chan-v" id="chan-${k}">off</span></div>`,
        ).join('')}
      </div>
      <details class="ins-watch">
        <summary>Sensors</summary>
        <div class="watch-grid">
          ${SENSORS.map(
            (sen) => `<div class="watch-row"><span class="watch-k">${sen.label}</span>
              <span class="watch-v" id="sense-${sen.id}">0</span></div>`,
          ).join('')}
        </div>
      </details>
      <div class="ins-transport">
        <button id="ins-pause" title="Pause the battle. Shortcut: space">Pause</button>
        <button id="ins-step" title="Move on one frame. Shortcut: full stop">Step</button>
        <button id="ins-mute" title="Turn the sound off and on">Sound</button>
        <span class="ins-speeds">
          ${SPEEDS.map(
            (s) => `<button class="spd ${s === 1 ? 'on' : ''}" data-speed="${s}">${s}&times;</button>`,
          ).join('')}
        </span>
      </div>
      <div class="ins-actions">
        <button id="ins-recall" title="Free a stuck bot and start its script again. Shortcut: C">Recall bot</button>
        <button id="ins-rerun" title="Run the same battle again. Shortcut: R">Run again</button>
        <button id="ins-workshop" title="Back to the editor. Shortcut: B">Workshop</button>
      </div>`;

    this.scriptHost = this.root.querySelector('#ins-script')!;
    this.statusEl = this.root.querySelector('#ins-status')!;
    this.noteEl = this.root.querySelector('#ins-note')!;
    for (const sen of SENSORS) {
      this.senseCells.set(sen.id, this.root.querySelector(`#sense-${sen.id}`)!);
    }
    for (const k of CHANNELS) this.chanCells.set(k, this.root.querySelector(`#chan-${k}`)!);

    this.root.querySelector<HTMLButtonElement>('#ins-pause')!.onclick = () => this.togglePause();
    this.root.querySelector<HTMLButtonElement>('#ins-step')!.onclick = () => this.step();
    const mute = this.root.querySelector<HTMLButtonElement>('#ins-mute')!;
    mute.classList.toggle('on', audioEnabled());
    mute.onclick = () => {
      const on = !audioEnabled();
      toggleAudio(on);
      mute.classList.toggle('on', on);
      mute.textContent = on ? 'Sound' : 'Muted';
    };

    this.root.querySelector<HTMLButtonElement>('#ins-hide')!.onclick = () => this.onHide();
    this.root.querySelector<HTMLButtonElement>('#ins-recall')!.onclick = () => this.onRecall();
    this.root.querySelector<HTMLButtonElement>('#ins-rerun')!.onclick = () => this.onRerun();
    this.root.querySelector<HTMLButtonElement>('#ins-workshop')!.onclick = () => this.onWorkshop();
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
      b.onclick = () => this.setSpeed(Number(b.dataset.speed));
    }
  }

  show() {
    this.root.classList.add('active');
  }

  hide() {
    this.root.classList.remove('active');
    this.builtFor = null;
  }

  togglePause() {
    this.transport.paused = !this.transport.paused;
    const b = this.root.querySelector<HTMLButtonElement>('#ins-pause')!;
    b.textContent = this.transport.paused ? 'Resume' : 'Pause';
    b.classList.toggle('on', this.transport.paused);
  }

  step() {
    if (!this.transport.paused) this.togglePause();
    this.transport.stepOnce = true;
  }

  setSpeed(v: number) {
    this.transport.speed = v;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
      b.classList.toggle('on', Number(b.dataset.speed) === v);
    }
  }

  cycleSpeed(dir: number) {
    const i = SPEEDS.indexOf(this.transport.speed);
    this.setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))]);
  }

  /** Build the script markup once for this battle. */
  private build(vm: ClankVM) {
    // The battle runs a *clone* of the program, so block ids differ from the
    // editor's copy. Render the clone the interpreter is actually executing.
    const view = new ScriptEditor(vm.program, () => {});
    this.scriptHost.innerHTML = view.staticCanvas();
    delete this.scriptHost.dataset.watching;
    this.nodes.clear();
    this.profs.clear();
    for (const el of this.scriptHost.querySelectorAll<HTMLElement>('[data-node]')) {
      this.nodes.set(el.dataset.node!, el);
      const prof = el.querySelector<HTMLElement>('.prof');
      if (prof) this.profs.set(el.dataset.node!, prof);
    }
    this.conditionIds.clear();
    const walk = (list: Node[]) => {
      for (const n of list) {
        if (n.op === 'if' || n.op === 'if_else') this.conditionIds.add(n.id);
        walk(n.body ?? []);
        walk(n.body2 ?? []);
      }
    };
    for (const st of vm.program.stacks) walk(st.body);

    this.builtFor = vm;
    this.lastLive = null;
    this.statsAt = 0;
  }

  update(m: Match, now: number) {
    // No player means the player is watching two other bots. There is no script
    // to show, and the one thing this panel must never do is fall back to
    // somebody else's: a challenger's program is sealed, and this is the only
    // place in the game that renders a program at all.
    const me = m.player;
    if (!me) {
      this.showWatching();
      return;
    }
    const vm = m.vms.get(me);
    if (!vm) return;
    if (this.builtFor !== vm) this.build(vm);

    // Move the highlight. One class swap, not a re-render.
    const live = me.alive && m.phase === 'fighting' ? vm.activeBlockId : null;
    if (live !== this.lastLive) {
      if (this.lastLive) this.nodes.get(this.lastLive)?.classList.remove('running');
      if (live) {
        const el = this.nodes.get(live);
        el?.classList.add('running');
        if (el) this.keepVisible(el);
      }
      this.lastLive = live;
    }

    if (now - this.statsAt > 250) {
      this.statsAt = now;
      this.paintStats(vm);
      this.paintWatch(m, vm);
    }

    const status = !me.alive
      ? 'knocked out'
      : m.phase === 'countdown'
        ? 'starting'
        : m.phase === 'over'
          ? 'battle over'
          : this.transport.paused
            ? 'paused'
            : 'running';
    if (this.statusEl.textContent !== status) this.statusEl.textContent = status;

    const note = vm.note || (this.deadStacks(vm) ?? '');
    if (this.noteEl.textContent !== note) {
      this.noteEl.textContent = note;
      this.noteEl.classList.toggle('shown', !!note);
    }
  }

  /** Spectating. Blank the panel rather than showing whoever happens to be first. */
  private showWatching() {
    if (this.builtFor !== null || this.scriptHost.dataset.watching !== '1') {
      this.scriptHost.innerHTML =
        '<p class="ins-empty">You are watching this one. Only your own script is ever shown here, so a bot somebody sent you stays sealed.</p>';
      this.scriptHost.dataset.watching = '1';
      this.nodes.clear();
      this.profs.clear();
      this.conditionIds.clear();
      this.builtFor = null;
      this.lastLive = null;
    }
    if (this.statusEl.textContent !== 'watching') this.statusEl.textContent = 'watching';
    for (const [, cell] of this.senseCells) if (cell.textContent !== '—') cell.textContent = '—';
    for (const [, cell] of this.chanCells) if (cell.textContent !== '—') cell.textContent = '—';
  }

  /** Flag whole stacks that have never fired — almost always the real bug. */
  private deadStacks(vm: ClankVM): string | null {
    if (vm.elapsed < 8) return null;
    const dead = vm.program.stacks.filter((s) => !vm.hits.get(s.hat.id));
    if (!dead.length) return null;
    return dead.length === 1
      ? 'One stack has never run. Its event may never happen.'
      : `${dead.length} stacks have never run. Their events may never happen.`;
  }

  /**
   * The live sensor values and the three channels.
   *
   * The channels are the point of this. They persist: a drive block sets the
   * throttle and nothing clears it until another motion block runs, so a script
   * that spends a second aiming spends that second driving as well. That is
   * invisible from reading the script and it catches everybody.
   */
  private paintWatch(m: Match, vm: ClankVM) {
    const bot = m.player;
    if (!bot) return;
    const s = vm.senses(m) as unknown as Record<string, number>;
    for (const sen of SENSORS) {
      const cell = this.senseCells.get(sen.id);
      if (!cell) continue;
      const text = formatSense(sen.id, sen.unit, s[sen.id] ?? 0);
      if (cell.textContent !== text) cell.textContent = text;
    }

    const c = vm.channels;
    // Throttle off and still moving is coasting, which is a different thing
    // from stopped: the bot has no brakes and slides for a while.
    const dir =
      c.throttle > 0.05
        ? 'forward'
        : c.throttle < -0.05
          ? 'reverse'
          : bot.speed > 0.3
            ? 'coasting'
            : 'stopped';
    // Kept short on purpose: the cell is a third of a phone's width.
    const steer = c.turn > 0.05 ? ', right' : c.turn < -0.05 ? ', left' : '';
    this.setChan('driving', `${dir}${steer}`, c.throttle !== 0);

    const gap = c.turretTarget === null ? null : Math.abs(wrapDeg(deg(c.turretTarget - bot.turret)));
    this.setChan(
      'turret',
      gap === null ? 'holding' : gap < 1 ? 'on its mark' : `${Math.round(gap)}° to go`,
      gap !== null && gap >= 1,
    );

    const radar =
      c.radarSpin !== 0
        ? `sweeping ${c.radarSpin > 0 ? 'right' : 'left'}`
        : c.radarTarget === null
          ? 'holding'
          : 'turning';
    this.setChan('radar', radar, c.radarSpin !== 0);
  }

  private setChan(key: string, text: string, busy: boolean) {
    const el = this.chanCells.get(key);
    if (!el) return;
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('busy', busy);
  }

  private paintStats(vm: ClankVM) {
    const total = Math.max(0.001, vm.elapsed);
    for (const [id, el] of this.profs) {
      const hits = vm.hits.get(id) ?? 0;
      const secs = vm.seconds.get(id) ?? 0;
      const pct = Math.round((secs / total) * 100);
      const host = this.nodes.get(id);

      if (hits === 0) {
        el.textContent = 'never';
        host?.classList.add('cold');
        continue;
      }
      host?.classList.remove('cold');

      // A condition that runs constantly and is never once true looks perfectly
      // healthy on the tally, but everything inside it is dead code.
      if (this.conditionIds.has(id) && (vm.trueHits.get(id) ?? 0) === 0) {
        el.textContent = `${hits}× · never true`;
        host?.classList.add('cold');
        continue;
      }

      el.textContent = pct >= 1 ? `${hits}× · ${pct}%` : `${hits}×`;
    }
  }

  private keepVisible(el: HTMLElement) {
    const host = this.scriptHost;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < host.scrollTop + 8) host.scrollTop = Math.max(0, top - 24);
    else if (bottom > host.scrollTop + host.clientHeight - 8) {
      host.scrollTop = bottom - host.clientHeight + 24;
    }
  }
}
