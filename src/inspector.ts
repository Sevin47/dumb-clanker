import { ScriptEditor } from './editor';
import type { Match } from './match';
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

  transport: Transport = { paused: false, speed: 1, stepOnce: false };

  constructor(
    root: HTMLElement,
    private onRecall: () => void,
    private onRerun: () => void,
    private onWorkshop: () => void,
  ) {
    this.root = root;
    this.root.innerHTML = `
      <header class="ins-head">
        <h2>Your script</h2>
        <span class="ins-status" id="ins-status">waiting</span>
      </header>
      <div class="ins-script" id="ins-script"></div>
      <p class="ins-note" id="ins-note"></p>
      <div class="ins-transport">
        <button id="ins-pause" title="Pause the battle. Shortcut: space">Pause</button>
        <button id="ins-step" title="Move on one frame. Shortcut: full stop">Step</button>
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

    this.root.querySelector<HTMLButtonElement>('#ins-pause')!.onclick = () => this.togglePause();
    this.root.querySelector<HTMLButtonElement>('#ins-step')!.onclick = () => this.step();
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
    this.nodes.clear();
    this.profs.clear();
    for (const el of this.scriptHost.querySelectorAll<HTMLElement>('[data-node]')) {
      this.nodes.set(el.dataset.node!, el);
      const prof = el.querySelector<HTMLElement>('.prof');
      if (prof) this.profs.set(el.dataset.node!, prof);
    }
    this.builtFor = vm;
    this.lastLive = null;
    this.statsAt = 0;
  }

  update(m: Match, now: number) {
    const vm = m.vms.get(m.player);
    if (!vm) return;
    if (this.builtFor !== vm) this.build(vm);

    // Move the highlight. One class swap, not a re-render.
    const live = m.player.alive && m.phase === 'fighting' ? vm.activeBlockId : null;
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
    }

    const status = !m.player.alive
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

  /** Flag whole stacks that have never fired — almost always the real bug. */
  private deadStacks(vm: ClankVM): string | null {
    if (vm.elapsed < 8) return null;
    const dead = vm.program.stacks.filter((s) => !vm.hits.get(s.hat.id));
    if (!dead.length) return null;
    return dead.length === 1
      ? 'One stack has never run. Its event may never happen.'
      : `${dead.length} stacks have never run. Their events may never happen.`;
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
