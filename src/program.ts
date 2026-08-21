import { BLOCK_BY_OP } from './blocks';

/** One block instance in a program. */
export interface Node {
  id: string;
  op: string;
  args: Record<string, string | number>;
  body?: Node[];
  body2?: Node[];
}

export interface Stack {
  id: string;
  hat: Node;
  body: Node[];
}

export interface Program {
  stacks: Stack[];
}

let seq = 0;
export const uid = (p = 'b') => `${p}${(seq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** Companion arg holding which sensor drives a number slot ('' = a set amount). */
export const srcKey = (key: string) => `${key}_src`;

export function makeNode(op: string): Node {
  const def = BLOCK_BY_OP[op];
  const args: Record<string, string | number> = {};
  for (const [key, slot] of Object.entries(def?.slots ?? {})) {
    args[key] = slot.def;
    if (slot.kind === 'number') args[srcKey(key)] = '';
  }
  const n: Node = { id: uid(), op, args };
  if (def?.bodies) n.body = [];
  if (def?.bodies === 2) n.body2 = [];
  return n;
}

export function cloneNode(n: Node): Node {
  return {
    id: uid(),
    op: n.op,
    args: { ...n.args },
    ...(n.body ? { body: n.body.map(cloneNode) } : {}),
    ...(n.body2 ? { body2: n.body2.map(cloneNode) } : {}),
  };
}

export const cloneProgram = (p: Program): Program => ({
  stacks: p.stacks.map((s) => ({ id: uid('s'), hat: cloneNode(s.hat), body: s.body.map(cloneNode) })),
});

export function countBlocks(p: Program): number {
  const walk = (list: Node[]): number => list.reduce((n, b) => n + 1 + walk(b.body ?? []) + walk(b.body2 ?? []), 0);
  return p.stacks.reduce((n, s) => n + 1 + walk(s.body), 0);
}

// ---------------------------------------------------------------- authoring

const n = (op: string, args: Record<string, string | number> = {}, body?: Node[], body2?: Node[]): Node => {
  const node = makeNode(op);
  Object.assign(node.args, args);
  if (body) node.body = body;
  if (body2) node.body2 = body2;
  return node;
};

const stack = (hatOp: string, hatArgs: Record<string, string | number>, body: Node[]): Stack => ({
  id: uid('s'),
  hat: n(hatOp, hatArgs),
  body,
});

/** An amount driven by a sensor reading, plus an optional offset. */
const sv = (sensor: string, add = 0) => ({ n: add, n_src: sensor });

/**
 * The script a new bot starts with.
 *
 * Deliberately poor, and measured to be so: about 2 wins in 10 against the
 * roster, dealing roughly half the damage it takes. It shows the one pattern
 * worth copying — sweep, and when the beam finds somebody, swing the gun onto
 * them and shoot — and then does everything else badly. It drives in long
 * straight lines, never holds the radar on anyone, fires the weakest round in
 * the game, and never checks whether the gun is lined up first.
 *
 * A starter that already plays well leaves nothing to work out.
 */
export const starterProgram = (): Program => ({
  stacks: [
    stack('when_start', {}, [
      n('forever', {}, [
        n('sweep', { dir: 'right' }),
        n('drive', { dir: 'forward', n: 2.5 }),
        n('turn_body', { dir: 'right', n: 45 }),
      ]),
    ]),
    stack('when_scanned', {}, [n('turn_turret', { dir: 'right', ...sv('turret_turn') }), n('fire', { n: 0.5 })]),
    stack('when_wall', {}, [n('drive', { dir: 'backward', n: 0.8 }), n('turn_body', { dir: 'right', n: 120 })]),
  ],
});

export interface RivalDef {
  id: string;
  name: string;
  tagline: string;
  /**
   * The one thing this opponent is here to teach. They are a difficulty curve
   * pretending to be a menu, so each one is beatable with a skill the previous
   * one made you learn.
   */
  lesson: string;
  program: () => Program;
}

/**
 * The opposition, in the order they should be met. Every one is written in the
 * same blocks the player has, though the scripts are not readable: work out
 * what they are doing by watching them.
 *
 * The order is the curve. Beat one and the next unlocks.
 */
export const RIVALS: RivalDef[] = [
  {
    id: 'lamppost',
    lesson: 'Aiming. It never moves, so if you cannot hit it the problem is your gun, not their evasion.',
    name: 'Lamppost',
    tagline: 'Never moves. Sweeps, swings the gun on, and fires heavy. Perfect aim and an easy target.',
    program: () => ({
      stacks: [
        stack('when_start', {}, [n('forever', {}, [n('sweep', { dir: 'right' })])]),
        stack('when_scanned', {}, [
          n('turn_turret', { dir: 'right', ...sv('turret_turn') }),
          n('if', { sensor: 'gun_error', cmp: 'lt', n: 4 }, [n('fire', { n: 2 })]),
        ]),
      ],
    }),
  },
  {
    id: 'pacer',
    lesson: 'Leading. It moves in a straight line, which is the easiest movement in the game to shoot in front of.',
    name: 'Pacer',
    tagline: 'Drives back and forth while sweeping. Learns the hard way that moving in a straight line is not evasion.',
    program: () => ({
      stacks: [
        stack('when_start', {}, [
          n('forever', {}, [
            n('sweep', { dir: 'right' }),
            n('drive', { dir: 'forward', n: 1.6 }),
            n('drive', { dir: 'backward', n: 1.6 }),
          ]),
        ]),
        stack('when_scanned', {}, [
          n('turn_turret', { dir: 'right', ...sv('turret_turn') }),
          n('if', { sensor: 'gun_error', cmp: 'lt', n: 5 }, [n('fire', { n: 1.5 })]),
        ]),
        stack('when_wall', {}, [n('turn_body', { dir: 'right', n: 120 })]),
      ],
    }),
  },
  {
    id: 'hunter',
    lesson: 'Escaping. It closes and fires heavy at point blank. Be somewhere else.',
    name: 'Hunter',
    tagline: 'Holds the beam on you and closes. Fires heavy at point blank, light at range.',
    program: () => ({
      stacks: [
        stack('when_start', {}, [n('forever', {}, [n('sweep', { dir: 'right' })])]),
        stack('when_scanned', {}, [
          n('turn_radar', { dir: 'right', ...sv('radar_turn') }),
          n('turn_turret', { dir: 'right', ...sv('turret_turn') }),
          n(
            'if_else',
            { sensor: 'target_distance', cmp: 'lt', n: 9 },
            [n('if', { sensor: 'gun_error', cmp: 'lt', n: 7 }, [n('fire', { n: 3 })]), n('charge', { n: 0.8 })],
            [n('if', { sensor: 'gun_error', cmp: 'lt', n: 4 }, [n('fire', { n: 1 })]), n('charge', { n: 1.4 })],
          ),
        ]),
        stack('when_wall', {}, [n('drive', { dir: 'backward', n: 0.6 }), n('turn_body', { dir: 'left', n: 90 })]),
      ],
    }),
  },
  {
    id: 'orbit',
    lesson: 'Tracking. It circles, so a gun aimed at where it was will miss where it is.',
    name: 'Orbit',
    tagline: 'Circles whatever it finds while tracking with radar and gun. The one to beat.',
    program: () => ({
      stacks: [
        stack('when_start', {}, [n('forever', {}, [n('sweep', { dir: 'right' })])]),
        stack('when_scanned', {}, [
          n('turn_radar', { dir: 'right', ...sv('radar_turn') }),
          n('turn_turret', { dir: 'right', ...sv('turret_turn') }),
          n('if', { sensor: 'gun_error', cmp: 'lt', n: 5 }, [n('fire', { n: 1.5 })]),
          n('strafe', { dir: 'left', n: 1.2 }),
        ]),
        stack('when_shot', {}, [n('strafe', { dir: 'right', n: 1.5 })]),
        stack('when_wall', {}, [n('turn_body', { dir: 'right', n: 90 }), n('drive', { dir: 'forward', n: 0.8 })]),
      ],
    }),
  },
  {
    id: 'coward',
    lesson: 'Closing. It runs and plinks from range, so you have to go and get it.',
    name: 'Coward',
    tagline: 'Keeps its distance and plinks with light, fast rounds. Runs when hurt.',
    program: () => ({
      stacks: [
        stack('when_start', {}, [n('forever', {}, [n('sweep', { dir: 'left' }), n('strafe', { dir: 'right', n: 1 })])]),
        stack('when_scanned', {}, [
          n('if', { sensor: 'target_distance', cmp: 'lt', n: 10 }, [n('retreat', { n: 1.2 })]),
          n('turn_turret', { dir: 'right', ...sv('turret_turn') }),
          n('if', { sensor: 'gun_error', cmp: 'lt', n: 4 }, [n('fire', { n: 0.8 })]),
        ]),
        stack('when_health_below', { n: 45 }, [n('retreat', { n: 2.5 })]),
        stack('when_wall', {}, [n('turn_body', { dir: 'left', n: 130 })]),
      ],
    }),
  },
];

/**
 * The order the roster should be met in, easiest first. Each one is beatable
 * with the skill the previous one forced you to learn.
 */
export const LADDER = ['lamppost', 'coward', 'pacer', 'orbit', 'hunter'];

/** The roster in ladder order, which is how the workshop shows it. */
export const rivalsInOrder = (): RivalDef[] => LADDER.map((id) => rivalById(id)).filter(Boolean);

export const rivalById = (id: string) => RIVALS.find((r) => r.id === id) ?? RIVALS[0];
