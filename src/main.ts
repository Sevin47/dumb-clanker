import './style.css';
import { Workshop } from './workshop';
import { consume, initInput, pressed } from './input';
import { Match, type Entrant } from './match';
import { MATCH_SECONDS } from './spec';
import { RIVALS, cloneProgram, countBlocks, rivalById, starterProgram } from './program';
import { Renderer } from './render';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLElement;

const renderer = new Renderer(canvas);
initInput();

let match: Match | null = null;
let lastEntrants: Entrant[] | null = null;

const workshop = new Workshop(overlay, starterProgram(), (entrants) => {
  lastEntrants = entrants;
  workshop.hide();
  canvas.classList.add('active');
  match = new Match(entrants);
});

function restart() {
  if (!lastEntrants) return;
  match = new Match(lastEntrants.map((e) => ({ ...e, program: cloneProgram(e.program) })));
}

function toWorkshop() {
  match = null;
  canvas.classList.remove('active');
  workshop.show();
}

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
    match.update(dt);
    renderer.draw(match, dt);

    if (match.phase === 'over') {
      if (pressed('r')) {
        consume('r');
        restart();
      } else if (pressed('b')) {
        consume('b');
        toWorkshop();
      }
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
    renderer,
    Match,
    programs: { starterProgram, RIVALS, rivalById, countBlocks, cloneProgram },
    /** Run one battle with no rendering and return the standings. */
    sim(entrants: Entrant[], maxSteps = 9000) {
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
