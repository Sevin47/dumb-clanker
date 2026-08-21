import { DAMAGE_KINDS, type DamageKind } from './bot';
import { Match, type Entrant } from './match';
import { cloneProgram } from './program';
import { MATCH_SECONDS } from './spec';

/**
 * The test bench: the same battle, over and over, with no rendering.
 *
 * One battle tells you almost nothing. Starting positions are random, a lucky
 * power-3 round early decides a lot, and a script that looks broken in one match
 * can win the next three. The only honest way to judge a change is to run the
 * field enough times for the noise to cancel.
 *
 * The battle loop is the real one from Match, stepped at the same fixed 1/60,
 * so a result here means the same thing as a result in the arena.
 */

/** A battle is 180 seconds, plus a little slack for the closing ceremony. */
const MAX_STEPS = Math.ceil(MATCH_SECONDS * 60) + 600;

/**
 * Ticks to run before handing the thread back.
 *
 * Measured: a headless battle is around 2,700 ticks and costs about 40ms, so
 * this is roughly one battle, or two frames of work. Small enough that the
 * progress bar moves and Stop still answers, large enough that the run is not
 * spending most of its life in setTimeout overhead.
 */
const TICKS_PER_SLICE = 2400;

export interface BenchRow {
  name: string;
  isPlayer: boolean;
  /** Battles won outright. */
  wins: number;
  /** Battles survived to the final bell. */
  survived: number;
  avgDamageDealt: number;
  avgDamageTaken: number;
  /** Mean seconds alive, so a bot that dies early is obvious. */
  avgSurvival: number;
  accuracy: number;
  /** Mean damage taken per battle, split by what caused it. */
  damageBy: Record<DamageKind, number>;
}

export interface BenchResult {
  battles: number;
  /** Battles that ran the clock out instead of ending in a knockout. */
  timeouts: number;
  rows: BenchRow[];
}

interface Tally {
  name: string;
  isPlayer: boolean;
  wins: number;
  survived: number;
  damageDealt: number;
  damageTaken: number;
  survival: number;
  shotsFired: number;
  shotsHit: number;
  damageBy: Record<DamageKind, number>;
}

const blankKinds = (): Record<DamageKind, number> => ({ shot: 0, wall: 0, ram: 0, other: 0 });

export interface BenchRun {
  cancel(): void;
}

/**
 * Run `battles` battles and report the averages.
 *
 * Cooperative rather than synchronous: it runs a slice, yields to the browser,
 * and picks up where it left off. `onProgress` fires after every slice.
 */
export function runBench(
  entrants: Entrant[],
  battles: number,
  onProgress: (done: number, total: number) => void,
  onDone: (result: BenchResult) => void,
): BenchRun {
  const tallies = new Map<string, Tally>();
  let done = 0;
  let timeouts = 0;
  let cancelled = false;
  let timer = 0;

  // Fresh programs every battle. A VM carries state, so handing the same
  // program object to battle two would let battle one's run leak into it.
  let match = newMatch();
  let steps = 0;

  function newMatch(): Match {
    return new Match(
      entrants.map((e) => ({ ...e, program: cloneProgram(e.program) })),
      { headless: true },
    );
  }

  function tallyFor(name: string, isPlayer: boolean): Tally {
    let t = tallies.get(name);
    if (!t) {
      t = {
        name,
        isPlayer,
        wins: 0,
        survived: 0,
        damageDealt: 0,
        damageTaken: 0,
        survival: 0,
        shotsFired: 0,
        shotsHit: 0,
        damageBy: blankKinds(),
      };
      tallies.set(name, t);
    }
    return t;
  }

  function record(m: Match) {
    const elapsed = MATCH_SECONDS - m.timeLeft;
    if (m.timeLeft <= 0) timeouts++;

    for (const bot of m.bots) {
      const t = tallyFor(bot.name, bot.isPlayer);
      if (m.result?.winner === bot) t.wins++;
      if (bot.alive) t.survived++;
      t.damageDealt += bot.damageDealt;
      t.damageTaken += bot.damageTaken;
      t.shotsFired += bot.shotsFired;
      t.shotsHit += bot.shotsHit;
      // A survivor gets credit for the whole battle.
      t.survival += bot.alive ? elapsed : bot.deathAt;
      for (const k of DAMAGE_KINDS) t.damageBy[k] += bot.damageBy[k];
    }
  }

  function finish() {
    const rows: BenchRow[] = [...tallies.values()]
      .map((t) => ({
        name: t.name,
        isPlayer: t.isPlayer,
        wins: t.wins,
        survived: t.survived,
        avgDamageDealt: t.damageDealt / done,
        avgDamageTaken: t.damageTaken / done,
        avgSurvival: t.survival / done,
        accuracy: t.shotsFired > 0 ? (100 * t.shotsHit) / t.shotsFired : 0,
        damageBy: DAMAGE_KINDS.reduce((acc, k) => {
          acc[k] = t.damageBy[k] / done;
          return acc;
        }, blankKinds()),
      }))
      // You first, then whoever is winning.
      .sort((a, b) => Number(b.isPlayer) - Number(a.isPlayer) || b.wins - a.wins);

    onDone({ battles: done, timeouts, rows });
  }

  function slice() {
    if (cancelled) return;

    for (let i = 0; i < TICKS_PER_SLICE; i++) {
      match.update(1 / 60);
      steps++;
      if (match.phase === 'over' || steps >= MAX_STEPS) {
        record(match);
        done++;
        steps = 0;
        if (done >= battles) {
          onProgress(done, battles);
          finish();
          return;
        }
        match = newMatch();
      }
    }

    onProgress(done, battles);
    timer = setTimeout(slice, 0) as unknown as number;
  }

  timer = setTimeout(slice, 0) as unknown as number;

  return {
    cancel() {
      cancelled = true;
      clearTimeout(timer);
    },
  };
}
