import {
  BLOCKS,
  BLOCK_BY_OP,
  COMPARES,
  SENSORS,
  SENSOR_BY_ID,
  allowedSensors,
  slotSuffix,
  type BlockDef,
  type Category,
} from './blocks';
import { cloneNode, makeNode, uid, type Node, type Program } from './program';

/**
 * The Clank Script editor.
 *
 * Blocks are dragged out of the palette and dropped onto explicit gaps in the
 * script rather than snapped by proximity. Snapping looks magical when it works
 * and maddening when it does not; visible gaps that light up always land where
 * you aimed, which matters far more for someone who is not a programmer.
 *
 * A container path addresses a list of blocks: "0" is the body of stack 0, and
 * "0/b2" is the body of the third block in that stack. "c" addresses the else
 * branch. Every gap carries its container and index, so a drop is unambiguous.
 */

const CAT_LABEL: Record<Category, string> = {
  event: 'Events',
  motion: 'Moving',
  turret: 'Turret',
  radar: 'Radar',
  control: 'Control',
};

const CAT_ORDER: Category[] = ['event', 'motion', 'turret', 'radar', 'control'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function containerList(prog: Program, container: string): Node[] {
  const toks = container.split('/');
  const stack = prog.stacks[Number(toks[0])];
  if (!stack) return [];
  let list = stack.body;
  for (let i = 1; i < toks.length; i++) {
    const which = toks[i][0];
    const idx = Number(toks[i].slice(1));
    const node = list[idx];
    if (!node) return list;
    if (which === 'b') {
      node.body ??= [];
      list = node.body;
    } else {
      node.body2 ??= [];
      list = node.body2;
    }
  }
  return list;
}

interface DragPayload {
  /** A brand new block from the palette, or an existing one being moved. */
  kind: 'new' | 'move';
  op?: string;
  from?: { container: string; index: number };
}

/** The bar that appears while a block is held on a touch screen. */
const PLACING_BAR_ID = 'placing-bar';

export class ScriptEditor {
  private drag: DragPayload | null = null;
  /**
   * Touch screens have no drag and drop at all, so a block can be tapped to
   * pick up and a gap tapped to drop it. Mouse users get it too, and it is far
   * easier than dragging across a long script.
   */
  private held: DragPayload | null = null;
  /** Set while a match is running so the live block can be highlighted. */
  highlight: string | null = null;
  /**
   * Read-only mode renders the same blocks without the drop gaps, drag handles
   * or delete buttons, so the arena can show the running script using exactly
   * the visuals the player wrote it in.
   */
  private readOnly = false;

  constructor(
    private program: Program,
    private onChange: () => void,
  ) {}

  setProgram(p: Program) {
    this.program = p;
  }

  // ---------------------------------------------------------------- markup

  private slotMarkup(node: Node, def: BlockDef): string {
    const labelOf = (opts: Array<[string, string]>, v: unknown) =>
      opts.find((o) => o[0] === String(v))?.[1] ?? String(v);

    return def.text.replace(/\{(\w+)\}/g, (_, key: string) => {
      const slot = def.slots?.[key];
      if (!slot) return '';
      const value = node.args[key];

      if (slot.kind === 'number') {
        // Only sensors measuring the right thing may drive this amount, so
        // "drive forward for [bots still alive] seconds" is never offered.
        const usable = allowedSensors(def, key, node.args);
        const suffix = slotSuffix(def, key, node.args);
        const unit = suffix ? `<span class="unit">${esc(suffix)}</span>` : '';
        const src = String(node.args[`${key}_src`] ?? '');

        if (this.readOnly) {
          const add = Number(value) || 0;
          const chosen = SENSOR_BY_ID[src];
          if (chosen) {
            return `<b class="val">${esc(chosen.label)}</b>${add ? ` + <b class="val">${add}</b>` : ''}${unit}`;
          }
          return `<b class="val">${esc(String(value))}</b>${unit}`;
        }

        const off = this.readOnly ? 'disabled' : '';
        const box = `<input class="slot num" type="number" data-slot="${key}" value="${value}"
            min="${slot.min}" max="${slot.max}" step="${Math.abs(slot.max) <= 10 ? 0.1 : 1}"
            draggable="false" ${off} />`;

        // A slot nothing can measure — gun power, say — is just a number.
        if (!usable.length) return `${box}${unit}`;

        const picker = `<select class="slot src" data-src="${key}" draggable="false">
            <option value="">a set amount</option>
            ${usable
              .map(
                (x) =>
                  `<option value="${x.id}" ${x.id === src ? 'selected' : ''} title="${esc(x.help)}">${esc(x.label)}</option>`,
              )
              .join('')}
          </select>`;
        return `${picker}${src ? '<span class="plus">+</span>' : ''}${box}${unit}`;
      }

      if (this.readOnly) {
        const opts =
          slot.kind === 'sensor'
            ? SENSORS.map((x) => [x.id, x.label] as [string, string])
            : slot.kind === 'compare'
              ? COMPARES
              : slot.options;
        return `<b class="val">${esc(labelOf(opts, value))}</b>`;
      }

      if (slot.kind === 'sensor') {
        return `<select class="slot pick" data-slot="${key}" draggable="false">${SENSORS.map(
          (x) =>
            `<option value="${x.id}" ${x.id === value ? 'selected' : ''} title="${esc(x.help)}">${esc(x.label)}</option>`,
        ).join('')}</select>`;
      }

      const options = slot.kind === 'compare' ? COMPARES : slot.options;
      return `<select class="slot pick" data-slot="${key}" draggable="false">${options
        .map((o) => `<option value="${o[0]}" ${o[0] === value ? 'selected' : ''}>${esc(o[1])}</option>`)
        .join('')}</select>`;
    });
  }

  private gap(container: string, index: number): string {
    if (this.readOnly) return '';
    return `<div class="gap" data-container="${container}" data-index="${index}"></div>`;
  }

  private renderNode(node: Node, container: string, index: number): string {
    const def = BLOCK_BY_OP[node.op];
    if (!def) return '';
    const live = this.highlight === node.id ? ' live' : '';
    const head = `<div class="blk cat-${def.cat}${live}" draggable="${!this.readOnly}"
        data-node="${node.id}" data-container="${container}" data-idx="${index}"
        title="${esc(def.help)}"><span class="blk-text">${this.slotMarkup(node, def)}</span>
        ${this.readOnly ? '<span class="prof"></span>' : ''}</div>`;

    if (!def.bodies) return head;

    const inner = (which: 'b' | 'c', list: Node[]) => {
      const path = `${container}/${which}${index}`;
      const rows = list.map((child, i) => this.gap(path, i) + this.renderNode(child, path, i)).join('');
      return `<div class="blk-body">${rows}${this.gap(path, list.length)}</div>`;
    };

    const first = inner('b', node.body ?? []);
    const second =
      def.bodies === 2
        ? `<div class="blk cat-${def.cat} blk-mid">otherwise</div>${inner('c', node.body2 ?? [])}`
        : '';

    return `<div class="blk-wrap">${head}${first}${second}<div class="blk cat-${def.cat} blk-foot"></div></div>`;
  }

  private renderStack(stackIndex: number): string {
    const stack = this.program.stacks[stackIndex];
    const def = BLOCK_BY_OP[stack.hat.op];
    const live = this.highlight === stack.hat.id ? ' live' : '';
    const hat = `<div class="blk hat cat-event${live}" data-hat="${stackIndex}"
        data-node="${stack.hat.id}" title="${esc(def?.help ?? '')}">
        <span class="blk-text">${def ? this.slotMarkup(stack.hat, def) : stack.hat.op}</span>
        ${
          this.readOnly
            ? '<span class="prof"></span>'
            : `<button class="kill" data-killstack="${stackIndex}" title="Delete this whole stack">&times;</button>`
        }
      </div>`;
    const rows = stack.body
      .map((n, i) => this.gap(String(stackIndex), i) + this.renderNode(n, String(stackIndex), i))
      .join('');
    return `<div class="stack">${hat}${rows}${this.gap(String(stackIndex), stack.body.length)}</div>`;
  }

  palette(): string {
    return CAT_ORDER.map((cat) => {
      const items = BLOCKS.filter((b) => b.cat === cat);
      return `<h3 class="pal-head">${CAT_LABEL[cat]}</h3>
        <div class="pal-group">${items
          .map(
            (b) =>
              `<div class="blk pal cat-${b.cat}${b.hat ? ' hat' : ''}" draggable="true"
                 data-new="${b.op}" title="${esc(b.help)}">
                 <span class="blk-text">${this.slotMarkup(makeNode(b.op), b)}</span></div>`,
          )
          .join('')}</div>`;
    }).join('');
  }

  canvas(): string {
    const stacks = this.program.stacks.map((_, i) => this.renderStack(i)).join('');
    return `${stacks}<div class="newstack" data-newstack="1">Drop a “when…” block here to start another stack</div>`;
  }

  /** The same script, rendered for looking at rather than editing. */
  staticCanvas(): string {
    this.readOnly = true;
    const html = this.program.stacks.map((_, i) => this.renderStack(i)).join('');
    this.readOnly = false;
    return html;
  }

  // ---------------------------------------------------------------- events

  /** Call after the markup is in the DOM. */
  wire(root: HTMLElement) {
    const q = <T extends HTMLElement>(sel: string) => Array.from(root.querySelectorAll<T>(sel));

    const clearGaps = () => q('.gap').forEach((g) => g.classList.remove('over'));

    const help = document.getElementById('blockhelp');
    const showHelp = (op: string) => {
      const def = BLOCK_BY_OP[op];
      if (!help || !def) return;
      help.innerHTML = `<h4>${esc(def.text.replace(/\{\w+\}/g, '…'))}</h4><p>${esc(def.help)}</p>`;
      help.classList.remove('empty');
    };

    q<HTMLElement>('[data-new]').forEach((el) => {
      el.addEventListener('mouseenter', () => showHelp(el.dataset.new!));
      el.addEventListener('click', () => {
        showHelp(el.dataset.new!);
        const op = el.dataset.new!;
        if (this.held?.kind === 'new' && this.held.op === op) {
          this.hold(null, root);
          return;
        }
        this.hold({ kind: 'new', op }, root);
        el.classList.add('held');
      });
      el.addEventListener('dragstart', (ev) => {
        this.drag = { kind: 'new', op: el.dataset.new! };
        ev.dataTransfer?.setData('text/plain', el.dataset.new!);
        root.classList.add('dragging');
      });
      el.addEventListener('dragend', () => {
        this.drag = null;
        root.classList.remove('dragging');
        clearGaps();
      });
    });

    q<HTMLElement>('.blk[data-node]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        // Taps on a value inside the block are edits, not a pick-up.
        if ((ev.target as HTMLElement).closest('.slot, .kill')) return;
        ev.stopPropagation();
        const from = { container: el.dataset.container!, index: Number(el.dataset.idx) };
        if (this.held?.kind === 'move' && this.held.from?.container === from.container && this.held.from.index === from.index) {
          this.hold(null, root);
          return;
        }
        this.hold({ kind: 'move', from }, root);
        el.classList.add('held');
      });
      el.addEventListener('dragstart', (ev) => {
        ev.stopPropagation();
        this.drag = {
          kind: 'move',
          from: { container: el.dataset.container!, index: Number(el.dataset.idx) },
        };
        ev.dataTransfer?.setData('text/plain', el.dataset.node!);
        root.classList.add('dragging');
      });
      el.addEventListener('dragend', () => {
        this.drag = null;
        root.classList.remove('dragging');
        clearGaps();
      });
    });

    q<HTMLElement>('.gap').forEach((g) => {
      g.addEventListener('dragover', (ev) => {
        if (!this.drag) return;
        // A hat can only start a stack, never sit inside one.
        if (this.drag.kind === 'new' && BLOCK_BY_OP[this.drag.op!]?.hat) return;
        ev.preventDefault();
        g.classList.add('over');
      });
      g.addEventListener('dragleave', () => g.classList.remove('over'));
      g.addEventListener('drop', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        g.classList.remove('over');
        this.drop(g.dataset.container!, Number(g.dataset.index));
      });
      g.addEventListener('click', () => {
        if (!this.held) return;
        if (this.held.kind === 'new' && BLOCK_BY_OP[this.held.op!]?.hat) return;
        this.drag = this.held;
        const held = this.held;
        this.hold(null, root);
        this.drag = held;
        this.drop(g.dataset.container!, Number(g.dataset.index));
        this.drag = null;
      });
    });

    const newStack = root.querySelector<HTMLElement>('[data-newstack]');
    if (newStack) {
      newStack.addEventListener('dragover', (ev) => {
        if (this.drag?.kind === 'new' && BLOCK_BY_OP[this.drag.op!]?.hat) {
          ev.preventDefault();
          newStack.classList.add('over');
        }
      });
      newStack.addEventListener('dragleave', () => newStack.classList.remove('over'));
      newStack.addEventListener('click', () => {
        if (this.held?.kind !== 'new') return;
        const def = BLOCK_BY_OP[this.held.op!];
        if (!def?.hat) return;
        this.program.stacks.push({ id: uid('s'), hat: makeNode(this.held.op!), body: [] });
        this.hold(null, root);
        this.onChange();
      });
      newStack.addEventListener('drop', (ev) => {
        newStack.classList.remove('over');
        if (this.drag?.kind !== 'new') return;
        const def = BLOCK_BY_OP[this.drag.op!];
        if (!def?.hat) return;
        ev.preventDefault();
        this.program.stacks.push({ id: uid('s'), hat: makeNode(this.drag.op!), body: [] });
        this.onChange();
      });
    }

    // The palette doubles as a bin.
    const bin = root.querySelector<HTMLElement>('[data-bin]');
    if (bin) {
      bin.addEventListener('dragover', (ev) => {
        if (this.drag?.kind === 'move') {
          ev.preventDefault();
          bin.classList.add('binning');
        }
      });
      bin.addEventListener('dragleave', () => bin.classList.remove('binning'));
      bin.addEventListener('click', (ev) => {
        if (this.held?.kind !== 'move' || !this.held.from) return;
        if ((ev.target as HTMLElement).closest('[data-new]')) return;
        const list = containerList(this.program, this.held.from.container);
        list.splice(this.held.from.index, 1);
        this.hold(null, root);
        this.onChange();
      });
      bin.addEventListener('drop', (ev) => {
        bin.classList.remove('binning');
        if (this.drag?.kind !== 'move' || !this.drag.from) return;
        ev.preventDefault();
        const list = containerList(this.program, this.drag.from.container);
        list.splice(this.drag.from.index, 1);
        this.onChange();
      });
    }

    q<HTMLButtonElement>('[data-killstack]').forEach((b) => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        this.program.stacks.splice(Number(b.dataset.killstack), 1);
        this.onChange();
      };
    });

    // Slot edits.
    q<HTMLInputElement>('.blk[data-node] input.slot, .blk[data-hat] input.slot').forEach((inp) => {
      inp.addEventListener('mousedown', (e) => e.stopPropagation());
      inp.addEventListener('change', () => {
        const node = this.findNode(inp.closest('.blk') as HTMLElement);
        if (!node) return;
        node.args[inp.dataset.slot!] = Number(inp.value);
        this.onChange();
      });
    });
    q<HTMLSelectElement>('.blk select.slot').forEach((sel) => {
      sel.addEventListener('mousedown', (e) => e.stopPropagation());
      sel.addEventListener('change', () => {
        const el = sel.closest('.blk') as HTMLElement;
        const node = this.findNode(el);
        if (!node) return;
        if (sel.dataset.src !== undefined) {
          node.args[`${sel.dataset.src}_src`] = sel.value;
        } else {
          node.args[sel.dataset.slot!] = sel.value;
          // Switching the sensor on an "if" changes what the right-hand side is
          // allowed to measure. Drop a source that no longer fits.
          const def = BLOCK_BY_OP[node.op];
          for (const key of Object.keys(def?.slots ?? {})) {
            const src = String(node.args[`${key}_src`] ?? '');
            if (!src) continue;
            if (!allowedSensors(def, key, node.args).some((x) => x.id === src)) {
              node.args[`${key}_src`] = '';
            }
          }
        }
        this.onChange();
      });
    });
  }

  private findNode(el: HTMLElement | null): Node | null {
    if (!el) return null;
    if (el.dataset.hat !== undefined) return this.program.stacks[Number(el.dataset.hat)]?.hat ?? null;
    const container = el.dataset.container;
    const idx = Number(el.dataset.idx);
    if (container === undefined) return null;
    return containerList(this.program, container)[idx] ?? null;
  }

  /** Pick a block up, or put down the one already held. */
  private hold(payload: DragPayload | null, root: HTMLElement) {
    this.held = payload;
    root.classList.toggle('placing', !!payload);
    for (const el of root.querySelectorAll('.blk.held')) el.classList.remove('held');
    this.paintPlacingBar(root);
  }

  private paintPlacingBar(root: HTMLElement) {
    let bar = document.getElementById(PLACING_BAR_ID);
    if (!this.held) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = PLACING_BAR_ID;
      bar.className = 'placing-bar';
      document.body.appendChild(bar);
    }
    const what = this.held.kind === 'new' ? BLOCK_BY_OP[this.held.op!]?.text ?? 'block' : 'this block';
    bar.innerHTML = `<span>Tap a gap to place ${esc(what.replace(/\{\w+\}/g, '...'))}</span>
      <button type="button" data-cancel="1">Cancel</button>`;
    bar.querySelector<HTMLButtonElement>('[data-cancel]')!.onclick = () => this.hold(null, root);
  }

  private drop(container: string, index: number) {
    const d = this.drag;
    if (!d) return;

    if (d.kind === 'new') {
      const def = BLOCK_BY_OP[d.op!];
      if (def?.hat) return;
      containerList(this.program, container).splice(index, 0, makeNode(d.op!));
      this.onChange();
      return;
    }

    const from = d.from!;
    const fromList = containerList(this.program, from.container);
    const node = fromList[from.index];
    if (!node) return;

    // Refuse to drop a block inside itself, which would detach the subtree.
    if (container === from.container || container.startsWith(`${from.container}/b${from.index}`) ||
        container.startsWith(`${from.container}/c${from.index}`)) {
      if (container !== from.container) return;
    }

    const moved = cloneNode(node);
    fromList.splice(from.index, 1);
    const toList = containerList(this.program, container);
    const adjusted = from.container === container && from.index < index ? index - 1 : index;
    toList.splice(Math.max(0, Math.min(toList.length, adjusted)), 0, moved);
    this.onChange();
  }
}
