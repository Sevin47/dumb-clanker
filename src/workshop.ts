import { ScriptEditor } from './editor';
import { RIVALS, cloneProgram, countBlocks, rivalById, starterProgram, uid, type Program } from './program';
import type { Entrant } from './match';
import { exportScript, importScript, loadFile, saveFile, type SaveFile } from './storage';

/**
 * The workshop. There is no bot to build any more — everyone fights the same
 * standard chassis — so this screen is the program editor plus the battle
 * setup: who you want in the arena with you, and how many of them.
 */

const MAX_OPPONENTS = 5;

export class Workshop {
  program: Program;
  /** Rival ids in the field, in order. The same bot may appear more than once. */
  field: string[];
  name: string;
  private editor: ScriptEditor;
  private file: SaveFile;
  private storageBroken = false;
  private flash = '';

  constructor(
    private root: HTMLElement,
    private onFight: (entrants: Entrant[]) => void,
  ) {
    this.file = loadFile();
    this.program = this.file.current;
    this.field = this.file.field;
    this.name = this.file.currentName;
    this.editor = new ScriptEditor(this.program, () => {
      this.persist();
      this.render();
    });
  }

  /**
   * Autosave. Every edit writes straight through, so a refresh, a crash or a
   * closed tab never costs work — which is the whole point of it.
   */
  private persist() {
    this.file.current = this.program;
    this.file.currentName = this.name;
    this.file.field = this.field;
    this.storageBroken = !saveFile(this.file);
  }

  private say(msg: string) {
    this.flash = msg;
    window.setTimeout(() => {
      if (this.flash !== msg) return;
      this.flash = '';
      if (this.root.classList.contains('active')) this.render();
    }, 2600);
  }

  show() {
    this.root.classList.add('active');
    this.render();
  }

  hide() {
    this.root.classList.remove('active');
    this.root.innerHTML = '';
  }

  setProgram(p: Program, name?: string) {
    this.program = p;
    if (name !== undefined) this.name = name;
    this.editor.setProgram(p);
    this.persist();
  }

  private saveToLibrary() {
    const name = this.name.trim() || 'Untitled';
    const existing = this.file.library.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const entry = {
      id: existing?.id ?? uid('save'),
      name,
      savedAt: Date.now(),
      program: cloneProgram(this.program),
    };
    if (existing) Object.assign(existing, entry);
    else this.file.library.unshift(entry);
    this.persist();
    this.say(existing ? `Updated ${name}` : `Saved ${name}`);
    this.render();
  }

  private libraryCard(): string {
    const rows = this.file.library.length
      ? this.file.library
          .map(
            (x) => `<li>
              <button class="lib-load" data-load="${x.id}" title="Load this script into the editor">
                <b>${escapeHtml(x.name)}</b><i>${countBlocks(x.program)} blocks &middot; ${when(x.savedAt)}</i>
              </button>
              <button class="drop" data-del="${x.id}" title="Delete this script">&times;</button>
            </li>`,
          )
          .join('')
      : '<li class="empty">Nothing saved yet</li>';

    return `
      <section class="card">
        <h2>Scripts</h2>
        <label class="namerow">
          <span>Name</span>
          <input id="scriptname" type="text" value="${escapeHtml(this.name)}" maxlength="40" />
        </label>
        <div class="saverow">
          <button class="ghost small" id="savescript">Save</button>
          <button class="ghost small" id="exportscript" title="Download this script as a file">Export</button>
          <button class="ghost small" id="importbtn" title="Load a script from a file">Import</button>
          <input type="file" id="importfile" accept=".json,application/json" hidden />
        </div>
        <ul class="library">${rows}</ul>
        ${this.flash ? `<p class="flash">${escapeHtml(this.flash)}</p>` : ''}
        ${
          this.storageBroken
            ? '<p class="warn error">This browser will not let the game save. Use Export to keep your work.</p>'
            : '<p class="autosave">Autosaves as you edit.</p>'
        }
      </section>`;
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
            <div class="blockhelp empty" id="blockhelp">
              <p>Hover a block to see exactly what it does and when it finishes.</p>
            </div>
          </aside>

          <main class="script">
            <div class="script-head">
              <h2>Clank Script</h2>
              <span class="blockcount">${blocks} blocks</span>
              <button class="ghost small" id="resetscript">Starter script</button>
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
            ${this.libraryCard()}
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
        this.persist();
        this.render();
      };
    });
    q<HTMLButtonElement>('[data-remove]').forEach((b) => {
      b.onclick = () => {
        this.field.splice(Number(b.dataset.remove), 1);
        this.persist();
        this.render();
      };
    });

    this.root.querySelector<HTMLButtonElement>('#resetscript')!.onclick = () => {
      this.setProgram(starterProgram());
      this.render();
    };

    const nameInput = this.root.querySelector<HTMLInputElement>('#scriptname')!;
    nameInput.onchange = () => {
      this.name = nameInput.value;
      this.persist();
    };
    this.root.querySelector<HTMLButtonElement>('#savescript')!.onclick = () => this.saveToLibrary();
    this.root.querySelector<HTMLButtonElement>('#exportscript')!.onclick = () =>
      exportScript(this.name.trim() || 'clank-script', this.program);

    const fileInput = this.root.querySelector<HTMLInputElement>('#importfile')!;
    this.root.querySelector<HTMLButtonElement>('#importbtn')!.onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      const loaded = await importScript(f);
      if (!loaded) {
        this.say('That file is not a Clank Script.');
        this.render();
        return;
      }
      this.setProgram(loaded.program, loaded.name);
      this.say(`Loaded ${loaded.name}`);
      this.render();
    };

    q<HTMLButtonElement>('[data-load]').forEach((b) => {
      b.onclick = () => {
        const entry = this.file.library.find((x) => x.id === b.dataset.load);
        if (!entry) return;
        this.setProgram(cloneProgram(entry.program), entry.name);
        this.render();
      };
    });
    q<HTMLButtonElement>('[data-del]').forEach((b) => {
      b.onclick = () => {
        this.file.library = this.file.library.filter((x) => x.id !== b.dataset.del);
        this.persist();
        this.render();
      };
    });

    this.root.querySelector<HTMLButtonElement>('#fight')!.onclick = () => {
      if (this.field.length === 0) return;
      this.onFight(this.entrants());
    };
  }
}

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Rough, friendly timestamp. Nobody needs the seconds. */
function when(t: number): string {
  if (!t) return 'just now';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
