import './style.css';
import { Workshop } from './workshop';
import { consume, initInput, pressed } from './input';
import { Match, type Entrant } from './match';
import { MATCH_SECONDS } from './spec';
import { RIVALS, cloneProgram, countBlocks, rivalById, starterProgram } from './program';
import { Renderer } from './render';
import { checkBlocks, reportChecks } from './checks';
import { Inspector } from './inspector';
import { challengeFromUrl, clearChallengeFromUrl } from './storage';
import { playMatchAudio, resetAudio, startAudio } from './audio';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLElement;
const inspectorHost = document.getElementById('inspector') as HTMLElement;

const renderer = new Renderer(canvas);
initInput();

let match: Match | null = null;
let lastEntrants: Entrant[] | null = null;
/** Whether this battle's result has already been counted towards the ladder. */
let resultCounted = false;

const workshop = new Workshop(overlay, (entrants) => {
  lastEntrants = entrants;
  workshop.hide();
  canvas.classList.add('active');
  inspectorToggle.hidden = false;
  inspector.show();
  renderer.resize();
  resultCounted = false;
  // The Fight button is the player's first click, which is the only moment a
  // browser will let audio start.
  startAudio();
  resetAudio();
  match = new Match(entrants);
});

function restart() {
  if (!lastEntrants) return;
  resultCounted = false;
  resetAudio();
  match = new Match(lastEntrants.map((e) => ({ ...e, program: cloneProgram(e.program) })));
}

function toWorkshop() {
  match = null;
  canvas.classList.remove('active');
  inspectorHost.classList.remove('open');
  inspectorToggle.hidden = true;
  inspector.hide();
  renderer.resize();
  workshop.show();

/**
 * Somebody has been sent a bot.
 *
 * It goes straight into the arena and never into the editor. Reading a rival's
 * script is the one thing this game does not let you do, and a friend's bot is
 * a rival. Loading it into the editor would have handed over the answer.
 */
void (async () => {
  const shared = await challengeFromUrl();
  if (!shared) return;
  clearChallengeFromUrl();
  const blocks = countBlocks(shared.program);
  const ok = window.confirm(
    `You have been sent a bot: "${shared.name}" (${blocks} blocks).

` +
      'Put them in the arena? Your own script is untouched, and theirs stays sealed.',
  );
  if (!ok) return;
  workshop.addChallenger(shared.name, shared.program);
  workshop.show();
})();
}

/**
 * Free a bot that has got itself wedged, or a script that has talked itself
 * into a corner. Deliberately not free: the gun comes back hot and everything
 * the bot had scanned is forgotten.
 */
function recall() {
  match?.recallPlayer();
}

const inspector = new Inspector(inspectorHost, recall, restart, toWorkshop);

// On a narrow screen the inspector slides over the arena rather than sitting
// beside it, so it needs a way to open and close.
const inspectorToggle = document.getElementById('inspector-toggle') as HTMLButtonElement;
inspectorToggle.onclick = () => {
  const open = inspectorHost.classList.toggle('open');
  inspectorToggle.textContent = open ? 'Close' : 'Script';
};

workshop.show();

const onResize = () => renderer.resize();
window.addEventListener('resize', onResize);
onResize();

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (match) {
    // Nobody drives. Every bot is running its own program.
    const t = inspector.transport;
    if (!t.paused) match.update(dt * t.speed);
    else if (t.stepOnce) {
      t.stepOnce = false;
      match.update(1 / 60);
    }
    renderer.draw(match, dt);
    inspector.update(match, now);
    playMatchAudio(match);

    // Climb the ladder. Counted once, the moment the battle is decided.
    if (!resultCounted && match.phase === 'over') {
      resultCounted = true;
      // Only a battle you were actually in can climb the ladder.
      const me = match.player;
      if (me && match.result?.winner === me) workshop.recordWin();
    }

    if (pressed('c')) {
      consume('c');
      recall();
    }
    if (pressed(' ')) {
      consume(' ');
      inspector.togglePause();
    }
    if (pressed('.')) {
      consume('.');
      inspector.step();
    }
    if (pressed('[')) {
      consume('[');
      inspector.cycleSpeed(-1);
    }
    if (pressed(']')) {
      consume(']');
      inspector.cycleSpeed(1);
    }
    if (pressed('r')) {
      consume('r');
      restart();
    } else if (pressed('b')) {
      consume('b');
      toWorkshop();
    }
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/**
 * Debug handle. Balance work here is impossible by hand, so the console gets
 * everything needed to run headless script-vs-script battles.
 *
 * Dev only — tree-shaken out of the production bundle.
 */
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__clanker = {
    get match() {
      return match;
    },
    get workshop() {
      return workshop;
    },
    get inspector() {
      return inspector;
    },
    /** Behaviour checks for every block. See src/checks.ts. */
    checkBlocks,
    check() {
      // eslint-disable-next-line no-console
      console.log(reportChecks());
      return checkBlocks().filter((r) => !r.pass).length === 0 ? 'all passed' : 'see failures above';
    },
    renderer,
    Match,
    programs: { starterProgram, RIVALS, rivalById, countBlocks, cloneProgram },
    /** Run one battle with no rendering and return the standings. */
    sim(entrants: Entrant[], maxSteps = Math.ceil(MATCH_SECONDS * 60) + 600) {
      const m = new Match(entrants.map((e) => ({ ...e, program: cloneProgram(e.program) })));
      for (let i = 0; i < maxSteps; i++) {
        m.update(1 / 60);
        if (m.phase === 'over') break;
      }
      return {
        winner: m.result?.winner?.name ?? 'nobody',
        reason: m.result?.reason ?? 'timeout',
        seconds: Math.round(MATCH_SECONDS - m.timeLeft),
        standings: (m.result?.standings ?? []).map((b) => ({
          name: b.name,
          alive: b.alive,
          health: Math.round(b.healthPct),
          damage: Math.round(b.damageDealt),
          shots: b.shotsFired,
          hits: b.shotsHit,
          note: m.vms.get(b)?.note ?? '',
        })),
      };
    },
    /** Convenience: your starter script against a named field. */
    quick(...rivalIds: string[]) {
      const g = (window as unknown as Record<string, any>).__clanker;
      return g.sim([
        { name: 'You', program: starterProgram(), isPlayer: true },
        ...rivalIds.map((id) => ({ name: rivalById(id).name, program: rivalById(id).program(), isPlayer: false })),
      ]);
    },
  };
}
