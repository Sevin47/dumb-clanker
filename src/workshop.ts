import { runBench, type BenchResult, type BenchRun } from './bench';
import { DAMAGE_KINDS, DAMAGE_LABEL } from './bot';
import { ScriptEditor } from './editor';
import { LADDER, cloneProgram, countBlocks, rivalById, rivalsInOrder, starterProgram, uid, type Program } from './program';
import type { Entrant } from './match';
import {
  MAX_CHALLENGERS,
  challengeLink,
  exportScript,
  importScript,
  loadFile,
  saveFile,
  type SaveFile,
} from './storage';

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
  /** Which column shows when the screen is too narrow for all three. */
  private pane: 'blocks' | 'script' | 'battle' = 'script';
  private file: SaveFile;
  private storageBroken = false;
  private flash = '';

  /** Test bench state. One battle proves nothing, so this runs a stack of them. */
  private bench: BenchRun | null = null;
  private benchBattles = 30;
  private benchResult: BenchResult | null = null;

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
    // A bench run left going would keep chewing through battles behind the
    // arena, competing with the battle the player is actually watching.
    this.bench?.cancel();
    this.bench = null;
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
          <button class="ghost small" id="linkbtn" title="Copy a link that loads this bot, to send to somebody">Copy link</button>
          <input type="file" id="importfile" accept=".json,application/json" hidden />
        </div>
        <ul class="library">${rows}</ul>
        ${this.flash ? `<p class="flash">${escapeHtml(this.flash)}</p>` : ''}
        ${
          this.storageBroken
            ? '<p class="warn error">This browser will not let the game save. Use Export to keep your work.</p>'
            : '<p class="autosave">Saved as you type.</p>'
        }
      </section>`;
  }

  /** Rivals the player may put in the arena: everything beaten, plus the next one. */
  private unlocked(): Set<string> {
    const beaten = new Set(this.file.beaten);
    const out = new Set(beaten);
    // The first unbeaten rung is always available, or there is no way to climb.
    for (const id of LADDER) {
      if (!beaten.has(id)) {
        out.add(id);
        break;
      }
    }
    return out;
  }

  /**
   * Take in a bot somebody sent by link.
   *
   * It goes straight into the arena and never into the editor. Reading a
   * rival's script is the one thing this game does not let you do, and a
   * friend's bot is a rival: you beat it by watching it, not by opening it.
   */
  addChallenger(name: string, program: Program) {
    this.file.challengers.unshift({ id: uid('chal'), name, program, inField: true });
    // Oldest out first. Five is the arena cap, so a sixth could never fight.
    this.file.challengers = this.file.challengers.slice(0, MAX_CHALLENGERS);
    this.persist();
    this.pane = 'battle';
    this.render();
  }

  private dropChallenger(id: string) {
    this.file.challengers = this.file.challengers.filter((c) => c.id !== id);
    this.persist();
    this.render();
  }

  private toggleChallenger(id: string) {
    const c = this.file.challengers.find((x) => x.id === id);
    if (!c) return;
    c.inField = !c.inField;
    this.persist();
    this.render();
  }

  /** How many bots are lined up besides the player. */
  private opponentCount(): number {
    return this.field.length + this.file.challengers.filter((c) => c.inField).length;
  }

  /**
   * Whether there is a battle to run at all. One bot alone is a practice run,
   * which is a perfectly good thing to want.
   */
  private canFight(): boolean {
    return this.file.joinIn || this.opponentCount() >= 2;
  }

  /**
   * Called when a battle is won. Everything that was in the arena counts, so
   * beating three at once climbs three rungs.
   */
  recordWin(): boolean {
    const before = this.file.beaten.length;
    for (const id of this.field) {
      if (!this.file.beaten.includes(id)) this.file.beaten.push(id);
    }
    if (this.file.beaten.length === before) return false;
    this.persist();
    return true;
  }

  /** Build the entrant list: you first, then the field. */
  entrants(): Entrant[] {
    const counts: Record<string, number> = {};
    // Sitting out is how two challengers fight each other.
    const list: Entrant[] = this.file.joinIn
      ? [{ name: 'You', program: cloneProgram(this.program), isPlayer: true }]
      : [];
    for (const id of this.field) {
      const r = rivalById(id);
      counts[id] = (counts[id] ?? 0) + 1;
      const suffix = this.field.filter((f) => f === id).length > 1 ? ` ${counts[id]}` : '';
      list.push({ name: r.name + suffix, program: r.program(), isPlayer: false });
    }
    for (const c of this.file.challengers) {
      if (c.inField) list.push({ name: c.name, program: cloneProgram(c.program), isPlayer: false });
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

    const chals = this.file.challengers;
    const inField = chals.filter((c) => c.inField);
    const full = this.opponentCount() >= MAX_OPPONENTS;
    const open = this.unlocked();
    const beaten = new Set(this.file.beaten);
    const next = rivalsInOrder().find((r) => !beaten.has(r.id));
    const total = this.opponentCount() + (this.file.joinIn ? 1 : 0);

    return `
      <section class="card">
        <h2>The battle</h2>
        <p class="explain">${
          total === 0
            ? 'Nobody in the arena yet.'
            : total === 1
              ? 'One bot alone. A practice run: no opponents, full three minutes, good for watching how your movement behaves.'
              : `${total} bots in the arena.`
        }</p>
        <ol class="field">
          <li class="you ${this.file.joinIn ? '' : 'out'}">
            <span class="dot d0"></span>You
            ${this.file.joinIn ? '' : '<i class="sitting">sitting out</i>'}
            <button class="drop" data-joinin="1" title="${
              this.file.joinIn ? 'Sit this one out and watch' : 'Put your bot back in'
            }">${this.file.joinIn ? '&minus;' : '+'}</button>
          </li>
          ${rows}
          ${inField
            .map(
              (c) =>
                `<li class="challenger"><span class="dot d5"></span>${escapeHtml(c.name)}
                   <i>sent to you</i>
                   <button class="drop" data-togglechal="${c.id}" title="Take them out of the battle">&times;</button></li>`,
            )
            .join('')}
          ${total === 0 ? '<li class="empty">Nobody yet</li>' : ''}
        </ol>
        ${
          chals.length
            ? `<ul class="benched">${chals
                .filter((c) => !c.inField)
                .map(
                  (c) =>
                    `<li><button class="add" data-togglechal="${c.id}" ${full ? 'disabled' : ''}>+</button>
                       ${escapeHtml(c.name)} <i>sent to you</i>
                       <button class="drop" data-dropchal="${c.id}" title="Forget this bot">&times;</button></li>`,
                )
                .join('')}</ul>
               <p class="explain">A bot somebody sent you is sealed, the same as a rival. Work out what it does by watching it. Sit yourself out and two of them will fight each other.</p>`
            : ''
        }
        <ul class="ladder">
          ${rivalsInOrder()
            .map((r) => {
              const won = beaten.has(r.id);
              const can = open.has(r.id);
              const cls = won ? 'won' : can ? 'open' : 'locked';
              return `<li class="${cls}">
                <button class="add" data-add="${r.id}" ${full || !can ? 'disabled' : ''}
                  title="${can ? escapeHtml(r.tagline) : 'Beat the one above first'}">+</button>
                <div>
                  <b>${r.name}</b> ${won ? '<i class="tick">beaten</i>' : ''}
                  <span>${can ? escapeHtml(r.lesson) : 'Locked. Beat the one above first.'}</span>
                </div>
              </li>`;
            })
            .join('')}
        </ul>
        ${next ? `<p class="explain">Next up: <b>${next.name}</b>.</p>` : '<p class="explain">You have beaten the whole roster.</p>'}
      </section>`;
  }

  private benchCard(): string {
    const running = !!this.bench;
    const counts = [10, 30, 100];

    let body: string;
    if (running) {
      body = `
        <div class="benchrun">
          <div class="benchbar"><i id="bench-fill" style="width:0%"></i></div>
          <p class="explain" id="bench-count">Battle 0 of ${this.benchBattles}</p>
          <button class="ghost small" id="bench-cancel">Stop</button>
        </div>`;
    } else if (this.benchResult) {
      body = this.benchTable(this.benchResult);
    } else {
      body = '<p class="explain">Runs the same battle over and over with nothing drawn, then averages it. One battle tells you almost nothing.</p>';
    }

    return `
      <section class="card">
        <h2>Test bench</h2>
        ${body}
        <div class="addrow">
          ${counts
            .map(
              (n) =>
                `<button class="add" data-bench="${n}" ${running || this.field.length === 0 ? 'disabled' : ''}>
                   ${n} battles</button>`,
            )
            .join('')}
        </div>
        ${this.field.length === 0 ? '<p class="explain">Add an opponent first.</p>' : ''}
      </section>`;
  }

  private benchTable(r: BenchResult): string {
    const rows = r.rows
      .map((row) => {
        const rate = Math.round((100 * row.wins) / r.battles);
        return `<tr class="${row.isPlayer ? 'you' : ''}">
          <td>${row.isPlayer ? 'You' : row.name}</td>
          <td>${rate}%</td>
          <td>${Math.round(row.avgDamageDealt)}</td>
          <td>${Math.round(row.avgDamageTaken)}</td>
          <td>${Math.round(row.avgSurvival)}s</td>
          <td>${Math.round(row.accuracy)}%</td>
        </tr>`;
      })
      .join('');

    // What beat you, which is the part you can go and fix.
    const me = r.rows.find((row) => row.isPlayer);
    const split = me
      ? DAMAGE_KINDS.filter((k) => me.damageBy[k] >= 0.5)
          .sort((a, b) => me.damageBy[b] - me.damageBy[a])
          .map((k) => `${DAMAGE_LABEL[k]} ${Math.round(me.damageBy[k])}`)
          .join(', ')
      : '';

    return `
      <table class="bench">
        <thead><tr><th>Bot</th><th>Won</th><th>Dealt</th><th>Took</th><th>Alive</th><th>Hit</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="explain">${r.battles} battles, ${r.timeouts} went to the final bell.
        Damage, time alive and accuracy are averages per battle.</p>
      ${split ? `<p class="explain"><b>What hurt you:</b> ${split} per battle.</p>` : ''}`;
  }

  private startBench(battles: number) {
    if (this.field.length === 0 || this.bench) return;
    this.benchBattles = battles;
    this.benchResult = null;
    const entrants = this.entrants();

    this.bench = runBench(
      entrants,
      battles,
      (done, total) => {
        // Patch the two live nodes in place. Re-rendering the whole workshop
        // on every slice would rebuild the editor a hundred times a second.
        const fill = document.getElementById('bench-fill');
        const count = document.getElementById('bench-count');
        if (fill) fill.style.width = `${Math.round((100 * done) / total)}%`;
        if (count) count.textContent = `Battle ${Math.min(done + 1, total)} of ${total}`;
      },
      (result) => {
        this.bench = null;
        this.benchResult = result;
        this.render();
      },
    );
    this.render();
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
          <p class="pitch">Every bot is the same. Only the code is different.</p>
          <nav class="mtabs">
            <button data-pane="blocks" class="${this.pane === 'blocks' ? 'on' : ''}">Blocks</button>
            <button data-pane="script" class="${this.pane === 'script' ? 'on' : ''}">Script</button>
            <button data-pane="battle" class="${this.pane === 'battle' ? 'on' : ''}">Battle</button>
          </nav>
        </header>

        <div class="bays program" data-pane="${this.pane}">
          <aside class="palette" data-bin="1">
            <div class="rack-head">
              <h2>Blocks</h2>
              <p class="pal-hint">Tap a block, then tap a gap in the script. Dragging works too. To delete a block, tap it and then tap here.</p>
            </div>
            <div class="pal-list">${this.editor.palette()}</div>
            <div class="blockhelp empty" id="blockhelp">
              <p>Pick a block to read what it does.</p>
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
              <p class="explain"><b>When the battle starts</b> is your standing plan. Put a
                <b>forever</b> block inside it.</p>
              <p class="explain">Every other <b>when</b> stack cuts in, runs to the end, then hands back
                to your plan at the point it left.</p>
              <p class="explain">The hull, the turret and the radar turn separately. The radar is a
                narrow beam, so keep it moving or you will not find anybody.</p>
              <p class="explain">Nothing aims for you. Any amount can come from a sensor instead of a
                fixed number. Put <b>turret: how far to turn</b> into a turn block and the gun swings
                onto the target. It corrects once, so run it every lap.</p>
              <p class="explain">Then choose when to shoot. A good test is
                <b>if turret: how far off target is less than 5</b>.</p>
            </section>
            ${this.libraryCard()}
            ${this.battleCard()}
            ${this.benchCard()}
            <button id="fight" ${this.canFight() ? '' : 'disabled'}>
              ${
                this.canFight()
                  ? this.file.joinIn
                    ? this.opponentCount() === 0
                      ? 'Practice alone'
                      : 'Fight'
                    : 'Watch them fight'
                  : 'Add two bots, or join in'
              }</button>
            <p class="keys">Nobody drives. The script does.</p>
          </aside>
        </div>
      </div>`;

    this.wire();
    this.editor.wire(this.root);
  }

  private wire() {
    const q = <T extends HTMLElement>(sel: string) => Array.from(this.root.querySelectorAll<T>(sel));

    q<HTMLButtonElement>('nav.mtabs [data-pane]').forEach((b) => {
      b.onclick = () => {
        this.pane = b.dataset.pane as 'blocks' | 'script' | 'battle';
        this.render();
      };
    });

    const linkBtn = this.root.querySelector<HTMLButtonElement>('#linkbtn');
    if (linkBtn) {
      linkBtn.onclick = async () => {
        const url = await challengeLink(this.name.trim() || 'A challenger', this.program);
        if (!url) {
          this.say('That script is too big to fit in a link. Use Export.');
          this.render();
          return;
        }
        try {
          await navigator.clipboard.writeText(url);
          this.say('Link copied. Anyone who opens it gets this bot.');
        } catch {
          // Clipboard is blocked in plenty of places. Show it instead.
          window.prompt('Copy this link', url);
          this.say('');
        }
        this.render();
      };
    }

    q<HTMLButtonElement>('[data-togglechal]').forEach((b) => {
      b.onclick = () => this.toggleChallenger(b.dataset.togglechal!);
    });
    q<HTMLButtonElement>('[data-dropchal]').forEach((b) => {
      b.onclick = () => this.dropChallenger(b.dataset.dropchal!);
    });
    const joinBtn = this.root.querySelector<HTMLButtonElement>('[data-joinin]');
    if (joinBtn) {
      joinBtn.onclick = () => {
        this.file.joinIn = !this.file.joinIn;
        this.persist();
        this.render();
      };
    }

    q<HTMLButtonElement>('[data-bench]').forEach((b) => {
      b.onclick = () => this.startBench(Number(b.dataset.bench));
    });

    const cancel = this.root.querySelector<HTMLButtonElement>('#bench-cancel');
    if (cancel) {
      cancel.onclick = () => {
        this.bench?.cancel();
        this.bench = null;
        this.render();
      };
    }

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
      if (!this.canFight()) return;
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
