import { ScriptEditor } from './editor';
import { RIVALS, cloneProgram, countBlocks, rivalById, starterProgram, type Program } from './program';
import type { Entrant } from './match';

/**
 * The workshop. There is no bot to build any more — everyone fights the same
 * standard chassis — so this screen is the program editor plus the battle
 * setup: who you want in the arena with you, and how many of them.
 */

const MAX_OPPONENTS = 5;

export class Workshop {
  program: Program;
  /** Rival ids in the field, in order. The same bot may appear more than once. */
  field: string[] = ['lamppost', 'hunter'];
  private editor: ScriptEditor;

  constructor(
    private root: HTMLElement,
    initialProgram: Program,
    private onFight: (entrants: Entrant[]) => void,
  ) {
    this.program = initialProgram;
    this.editor = new ScriptEditor(this.program, () => this.render());
  }

  show() {
    this.root.classList.add('active');
    this.render();
  }

  hide() {
    this.root.classList.remove('active');
    this.root.innerHTML = '';
  }

  setProgram(p: Program) {
    this.program = p;
    this.editor.setProgram(p);
  }

  /** Build the entrant list: you first, then the field. */
  entrants(): Entrant[] {
    const counts: Record<string, number> = {};
    const list: Entrant[] = [
      { name: 'You', program: cloneProgram(this.program), isPlayer: true },
    ];
    for (const id of this.field) {
      const r = rivalById(id);
      counts[id] = (counts[id] ?? 0) + 1;
      const suffix = this.field.filter((f) => f === id).length > 1 ? ` ${counts[id]}` : '';
      list.push({ name: r.name + suffix, program: r.program(), isPlayer: false });
    }
    return list;
  }

  private battleCard(): string {
    const rows = this.field
      .map(
        (id, i) =>
          `<li><span class="dot d${i + 1}"></span>${rivalById(id).name}
             <button class="drop" data-remove="${i}" title="Take them out of the battle">&times;</button></li>`,
      )
      .join('');

    const full = this.field.length >= MAX_OPPONENTS;
    return `
      <section class="card">
        <h2>The battle</h2>
        <p class="explain">You against ${this.field.length || 'nobody'}${
          this.field.length ? ` other bot${this.field.length > 1 ? 's' : ''}` : ''
        }. Add the same one twice if you want to.</p>
        <ol class="field">
          <li class="you"><span class="dot d0"></span>You</li>
          ${rows || '<li class="empty">Nobody else yet</li>'}
        </ol>
        <div class="addrow">
          ${RIVALS.map(
            (r) =>
              `<button class="add" data-add="${r.id}" ${full ? 'disabled' : ''} title="${r.tagline}">
                 + ${r.name}</button>`,
          ).join('')}
        </div>
      </section>`;
  }

  private render() {
    const blocks = countBlocks(this.program);
    this.root.innerHTML = `
      <div class="garage">
        <div class="room" aria-hidden="true">
          <div class="wall"></div>
          <div class="floor"></div>
          <div class="lamp"></div>
        </div>

        <header class="topbar">
          <div class="brand">
            <span class="logo">DUMB CLANKER</span>
            <span class="where">Workshop</span>
          </div>
          <p class="pitch">Write a program. Set it loose. Every bot is identical &mdash; the code is the difference.</p>
        </header>

        <div class="bays program">
          <aside class="palette" data-bin="1">
            <div class="rack-head">
              <h2>Blocks</h2>
              <p class="pal-hint">Drag into the script. Drag a block back here to bin it.</p>
            </div>
            <div class="pal-list">${this.editor.palette()}</div>
          </aside>

          <main class="script">
            <div class="script-head">
              <h2>Clank Script</h2>
              <span class="blockcount">${blocks} blocks</span>
              <button class="ghost small" id="resetscript">Starter script</button>
              <select class="ghost small" id="copyrival">
                <option value="">Copy a rival&rsquo;s script&hellip;</option>
                ${RIVALS.map((r) => `<option value="${r.id}">${r.name}</option>`).join('')}
              </select>
            </div>
            <div class="script-canvas">${this.editor.canvas()}</div>
          </main>

          <aside class="readout">
            <section class="card">
              <h2>How it runs</h2>
              <p class="explain"><b>When the match starts</b> is your standing plan &mdash; put a
                <b>forever</b> block in it.</p>
              <p class="explain">Every other <b>when&hellip;</b> stack interrupts it, runs to the end,
                then your plan carries on where it left off.</p>
              <p class="explain">The hull, the turret and the radar all turn separately. Your radar is a
                narrow beam &mdash; keep it moving or you will not find anyone.</p>
              <p class="explain">Nothing aims for you. Any amount can be driven by a sensor instead of a
                fixed number: set a turn block to <b>turret turn needed</b> and it swings the gun onto
                the target. It corrects <b>once</b>, so run it every lap.</p>
              <p class="explain">Then decide for yourself when to shoot &mdash;
                <b>if how far my turret is off target is less than 5, fire</b>.</p>
            </section>
            ${this.battleCard()}
            <button id="fight" ${this.field.length === 0 ? 'disabled' : ''}>
              ${this.field.length === 0 ? 'Add an opponent' : 'Fight'}</button>
            <p class="keys">Nobody drives. Your script does.</p>
          </aside>
        </div>
      </div>`;

    this.wire();
    this.editor.wire(this.root);
  }

  private wire() {
    const q = <T extends HTMLElement>(sel: string) => Array.from(this.root.querySelectorAll<T>(sel));

    q<HTMLButtonElement>('[data-add]').forEach((b) => {
      b.onclick = () => {
        if (this.field.length >= MAX_OPPONENTS) return;
        this.field.push(b.dataset.add!);
        this.render();
      };
    });
    q<HTMLButtonElement>('[data-remove]').forEach((b) => {
      b.onclick = () => {
        this.field.splice(Number(b.dataset.remove), 1);
        this.render();
      };
    });

    this.root.querySelector<HTMLButtonElement>('#resetscript')!.onclick = () => {
      this.setProgram(starterProgram());
      this.render();
    };

    const copy = this.root.querySelector<HTMLSelectElement>('#copyrival')!;
    copy.onchange = () => {
      if (!copy.value) return;
      this.setProgram(rivalById(copy.value).program());
      this.render();
    };

    this.root.querySelector<HTMLButtonElement>('#fight')!.onclick = () => {
      if (this.field.length === 0) return;
      this.onFight(this.entrants());
    };
  }
}
