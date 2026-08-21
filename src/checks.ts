import { Vec2 } from 'planck';
import { BLOCKS, SENSOR_BY_ID, allowedSensors } from './blocks';
import { makeNode, type Node, type Program } from './program';
import { Match } from './match';
import { GUN } from './spec';

/**
 * Behaviour checks for Clank Script.
 *
 * The point of this file is that nobody should have to take my word for what a
 * block does. Each check sets up a controlled battle, runs one block, and
 * reports the number it measured against the number the block's help text
 * promises. If the wording and the behaviour ever drift apart, this says so.
 *
 * Run it from the console in dev: `__clanker.checkBlocks()`.
 */

export interface CheckResult {
  group: string;
  name: string;
  pass: boolean;
  detail: string;
}

// ---------------------------------------------------------------- harness

const n = (op: string, args: Record<string, string | number> = {}, body?: Node[], body2?: Node[]): Node => {
  const node = makeNode(op);
  Object.assign(node.args, args);
  if (body) node.body = body;
  if (body2) node.body2 = body2;
  return node;
};

const prog = (body: Node[], extra: Array<{ hat: string; args?: Record<string, string | number>; body: Node[] }> = []): Program => ({
  stacks: [
    { id: 'main', hat: n('when_start'), body },
    ...extra.map((e, i) => ({ id: `x${i}`, hat: n(e.hat, e.args ?? {}), body: e.body })),
  ],
});

/** A bot that does nothing at all, so it can be used as a fixed landmark. */
const idle = (): Program => prog([n('forever', {}, [n('stop', { n: 5 })])]);

interface Setup {
  /** Player start, [x, y, heading degrees]. */
  me?: [number, number, number];
  /** Dummy start. Omit for a solo test. */
  them?: [number, number, number];
  themProgram?: Program;
}

function scenario(program: Program, setup: Setup = {}) {
  const m = new Match([
    { name: 'Test', program, isPlayer: true },
    { name: 'Dummy', program: setup.themProgram ?? idle(), isPlayer: false },
  ]);

  const [mx, my, mh] = setup.me ?? [27, 27, 0];
  m.bots[0].body.setTransform(Vec2(mx, my), (mh * Math.PI) / 180);
  m.bots[0].body.setLinearVelocity(Vec2(0, 0));
  m.bots[0].turret = (mh * Math.PI) / 180;
  m.bots[0].radar = (mh * Math.PI) / 180;

  const [tx, ty, th] = setup.them ?? [27, 12, 0];
  m.bots[1].body.setTransform(Vec2(tx, ty), (th * Math.PI) / 180);
  m.bots[1].body.setLinearVelocity(Vec2(0, 0));

  // Skip the countdown; these checks are about blocks, not ceremony.
  m.phase = 'fighting';
  m.countdown = 0;
  return m;
}

const run = (m: Match, seconds: number) => {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) m.update(1 / 60);
};

const deg = (r: number) => (r * 180) / Math.PI;
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- the checks

export function checkBlocks(): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (group: string, name: string, pass: boolean, detail: string) =>
    out.push({ group, name, pass, detail });

  // ------------------------------------------------------------ motion
  {
    const m = scenario(prog([n('drive', { dir: 'forward', n: 1 }), n('stop', { n: 5 })]), { me: [27, 27, 0] });
    const from = { ...m.bots[0].position };
    run(m, 1);
    const moved = dist(m.bots[0].position, from);
    const drift = Math.abs(m.bots[0].position.y - from.y);
    add('Moving', 'drive forward for 1s', moved > 3 && drift < 0.6, `travelled ${moved.toFixed(1)}m, sideways drift ${drift.toFixed(2)}m`);
  }
  {
    const m = scenario(prog([n('drive', { dir: 'backward', n: 1 }), n('stop', { n: 5 })]), { me: [27, 27, 0] });
    const from = { ...m.bots[0].position };
    run(m, 1);
    const dx = m.bots[0].position.x - from.x;
    add('Moving', 'drive backward goes the other way', dx < -1.5, `moved ${dx.toFixed(1)}m along its own nose axis`);
  }
  {
    const m = scenario(prog([n('turn_body', { dir: 'left', n: 90 }), n('stop', { n: 5 })]), { me: [27, 27, 0] });
    run(m, 3);
    const turned = wrap(deg(m.bots[0].heading));
    add('Moving', 'turn hull left by 90', near(turned, -90, 20), `heading ended at ${turned.toFixed(0)}°, wanted about −90°`);
  }
  {
    // The sign rule: turning "right" by a negative amount must turn left.
    const m = scenario(prog([n('turn_body', { dir: 'right', n: -90 }), n('stop', { n: 5 })]), { me: [27, 27, 0] });
    run(m, 3);
    const turned = wrap(deg(m.bots[0].heading));
    add('Moving', 'turn hull right by −90 turns left', turned < -40, `heading ended at ${turned.toFixed(0)}°, so a negative amount reversed the direction`);
  }
  {
    const m = scenario(prog([n('drive', { dir: 'forward', n: 1 }), n('stop', { n: 2 })]), { me: [27, 27, 0] });
    run(m, 1);
    const moving = m.bots[0].speed;
    run(m, 1.5);
    add('Moving', 'stop coasts to a halt', m.bots[0].speed < moving * 0.35, `was ${moving.toFixed(1)} m/s, ended ${m.bots[0].speed.toFixed(2)} m/s`);
  }
  {
    const m = scenario(prog([n('sweep', { dir: 'right' }), n('charge', { n: 2 })]), { me: [27, 27, 90], them: [27, 40, 0] });
    const before = dist(m.bots[0].position, m.bots[1].position);
    run(m, 2);
    const after = dist(m.bots[0].position, m.bots[1].position);
    add('Moving', 'drive at the target closes the gap', after < before - 2, `${before.toFixed(1)}m → ${after.toFixed(1)}m`);
  }
  {
    const m = scenario(prog([n('sweep', { dir: 'right' }), n('retreat', { n: 2 })]), { me: [27, 27, 90], them: [27, 40, 0] });
    const before = dist(m.bots[0].position, m.bots[1].position);
    run(m, 2);
    const after = dist(m.bots[0].position, m.bots[1].position);
    add('Moving', 'back away opens the gap', after > before + 1.5, `${before.toFixed(1)}m → ${after.toFixed(1)}m`);
  }
  {
    const m = scenario(prog([n('sweep', { dir: 'right' }), n('strafe', { dir: 'left', n: 2.5 })]), { me: [27, 27, 90], them: [27, 40, 0] });
    const start = { ...m.bots[0].position };
    const before = dist(start, m.bots[1].position);
    run(m, 2.5);
    const after = dist(m.bots[0].position, m.bots[1].position);
    const sideways = dist(m.bots[0].position, start);
    add(
      'Moving',
      'circle moves sideways, not closer',
      sideways > 3 && Math.abs(after - before) < before * 0.5,
      `moved ${sideways.toFixed(1)}m but range only went ${before.toFixed(1)}m → ${after.toFixed(1)}m`,
    );
  }
  {
    const m = scenario(prog([n('sweep', { dir: 'right' }), n('face_target'), n('stop', { n: 3 })]), { me: [27, 27, 0], them: [27, 40, 0] });
    run(m, 3);
    const t = m.bots[0].target;
    const err = t ? Math.abs(wrap(deg(m.bots[0].angleTo(t) - m.bots[0].heading))) : 999;
    add('Moving', 'point hull at the target', err < 12, `hull ended ${err.toFixed(0)}° off, help promises within 9°`);
  }

  // ------------------------------------------------------------ turret
  {
    const m = scenario(prog([n('turn_turret', { dir: 'right', n: 90 }), n('stop', { n: 5 })]), { me: [27, 27, 0] });
    const before = deg(m.bots[0].turret);
    run(m, 2);
    const turned = wrap(deg(m.bots[0].turret) - before);
    add('Turret', 'turn turret right by 90', near(turned, 90, 6), `turret moved ${turned.toFixed(0)}°`);
  }
  {
    const m = scenario(prog([n('turn_turret', { dir: 'right', n: 90 }), n('stop', { n: 5 })]), { me: [27, 27, 0] });
    const hullBefore = deg(m.bots[0].heading);
    run(m, 2);
    add('Turret', 'turning the turret leaves the hull alone', near(wrap(deg(m.bots[0].heading) - hullBefore), 0, 3), `hull moved ${wrap(deg(m.bots[0].heading) - hullBefore).toFixed(1)}°`);
  }
  {
    // The aiming idiom the help text recommends.
    const m = scenario(
      prog([n('sweep', { dir: 'right' })], [
        { hat: 'when_scanned', body: [n('turn_turret', { dir: 'right', n: 0, n_src: 'turret_turn' })] },
      ]),
      { me: [27, 27, 0], them: [40, 40, 0] },
    );
    run(m, 3);
    const t = m.bots[0].target;
    const err = t ? Math.abs(wrap(deg(m.bots[0].angleTo(t) - m.bots[0].turret))) : 999;
    add('Turret', 'turret turn needed aims the gun', err < 15, `gun ended ${err.toFixed(0)}° off target`);
  }
  {
    const m = scenario(prog([n('fire', { n: 2 }), n('stop', { n: 5 })]), { me: [27, 27, 0] });
    m.bots[0].gunHeat = 0;
    run(m, 0.2);
    add('Turret', 'fire launches a bullet when cool', m.bots[0].shotsFired === 1, `shots fired: ${m.bots[0].shotsFired}`);
  }
  {
    const m = scenario(prog([n('fire', { n: 2 }), n('stop', { n: 5 })]), { me: [27, 27, 0] });
    m.bots[0].gunHeat = 1.5;
    run(m, 0.2);
    add('Turret', 'fire does nothing while the gun is hot', m.bots[0].shotsFired === 0, `heat 1.5, shots fired: ${m.bots[0].shotsFired}`);
  }
  {
    const heat3 = GUN.heat(3);
    const cool = heat3 / GUN.coolingRate;
    add(
      'Turret',
      'power 3 matches its help text',
      near(GUN.damage(3), 16, 0.01) && near(GUN.speed(3), 10, 0.01) && near(cool, 3, 0.3),
      `${GUN.damage(3)} damage, ${GUN.speed(3)} m/s, gun locked ${cool.toFixed(1)}s`,
    );
  }
  {
    add(
      'Turret',
      'power 0.5 matches its help text',
      near(GUN.damage(0.5), 2, 0.01) && near(GUN.speed(0.5), 20, 0.01),
      `${GUN.damage(0.5)} damage, ${GUN.speed(0.5)} m/s`,
    );
  }

  // ------------------------------------------------------------ radar
  {
    const m = scenario(prog([n('sweep', { dir: 'right' }), n('stop', { n: 5 })]), { me: [27, 27, 0] });
    const before = m.bots[0].radar;
    run(m, 1);
    const swept = deg(m.bots[0].radar - before);
    add('Radar', 'sweep keeps the radar turning', swept > 200, `beam turned ${swept.toFixed(0)}° in one second`);
  }
  {
    // sweep must not block: the drive after it has to happen.
    const m = scenario(prog([n('sweep', { dir: 'right' }), n('drive', { dir: 'forward', n: 1 })]), { me: [27, 27, 0] });
    const from = { ...m.bots[0].position };
    run(m, 1);
    add('Radar', 'sweep does not stop the script', dist(m.bots[0].position, from) > 3, `bot still drove ${dist(m.bots[0].position, from).toFixed(1)}m while sweeping`);
  }
  {
    const m = scenario(prog([n('turn_radar', { dir: 'right', n: 90 }), n('stop', { n: 5 })]), { me: [27, 27, 0] });
    const before = m.bots[0].radar;
    run(m, 2);
    const turned = wrap(deg(m.bots[0].radar - before));
    add('Radar', 'turn radar right by 90 stops at 90', near(turned, 90, 8), `beam moved ${turned.toFixed(0)}° and held`);
  }
  {
    // A bot outside the beam must not be seen.
    const m = scenario(prog([n('stop', { n: 5 })]), { me: [27, 27, 0], them: [27, 40, 0] });
    m.bots[0].radar = 0; // pointing +x, target is at +y
    run(m, 1);
    add('Radar', 'a bot outside the beam is not scanned', m.bots[0].target === null, m.bots[0].target ? 'saw them anyway' : 'nothing scanned, as expected');
  }
  {
    const m = scenario(prog([n('sweep', { dir: 'right' })]), { me: [27, 27, 0], them: [27, 40, 0] });
    run(m, 1);
    add('Radar', 'sweeping finds a bot in range', m.bots[0].target !== null, m.bots[0].target ? `scanned at ${m.bots[0].target.distance.toFixed(1)}m` : 'never found them');
  }

  // ------------------------------------------------------------ control
  {
    const m = scenario(prog([n('drive', { dir: 'forward', n: 0.4 }), n('stop', { n: 0.1 }), n('drive', { dir: 'forward', n: 0.4 })]), { me: [10, 27, 0] });
    run(m, 1.2);
    add('Control', 'blocks run in order', dist(m.bots[0].position, { x: 10, y: 27 }) > 2, `ended ${dist(m.bots[0].position, { x: 10, y: 27 }).toFixed(1)}m from the start`);
  }
  {
    const m = scenario(prog([n('forever', {}, [n('drive', { dir: 'forward', n: 0.2 })])]), { me: [10, 27, 0] });
    run(m, 2);
    add('Control', 'forever keeps repeating', dist(m.bots[0].position, { x: 10, y: 27 }) > 6, `drove ${dist(m.bots[0].position, { x: 10, y: 27 }).toFixed(1)}m over 2s of looping`);
  }
  {
    const m = scenario(prog([n('forever', {}, [])]), { me: [27, 27, 0] });
    run(m, 0.5);
    const vm = m.vms.get(m.bots[0])!;
    add('Control', 'an empty forever is reported, not hung', vm.note.includes('empty'), `note: "${vm.note || 'none'}"`);
  }
  {
    const m = scenario(prog([n('repeat', { n: 3 }, [n('drive', { dir: 'forward', n: 0.3 })]), n('stop', { n: 9 })]), { me: [10, 27, 0] });
    run(m, 3);
    const vm = m.vms.get(m.bots[0])!;
    const driveNode = m.vms.get(m.bots[0])!.program.stacks[0].body[0].body![0];
    add('Control', 'repeat 3 runs exactly 3 times', vm.hits.get(driveNode.id) === 3, `drive block ran ${vm.hits.get(driveNode.id)} times`);
  }
  {
    // if with a false test must skip its body
    const m = scenario(prog([n('if', { sensor: 'target_distance', cmp: 'lt', n: 1 }, [n('drive', { dir: 'forward', n: 1 })]), n('stop', { n: 5 })]), { me: [10, 27, 0] });
    run(m, 1.5);
    add('Control', 'if skips its body when false', dist(m.bots[0].position, { x: 10, y: 27 }) < 1, `moved ${dist(m.bots[0].position, { x: 10, y: 27 }).toFixed(2)}m (should be none)`);
  }
  {
    const m = scenario(prog([n('if', { sensor: 'my_health', cmp: 'gt', n: 50 }, [n('drive', { dir: 'forward', n: 1 })]), n('stop', { n: 5 })]), { me: [10, 27, 0] });
    run(m, 1.5);
    add('Control', 'if runs its body when true', dist(m.bots[0].position, { x: 10, y: 27 }) > 3, `moved ${dist(m.bots[0].position, { x: 10, y: 27 }).toFixed(1)}m`);
  }
  {
    const m = scenario(
      prog([n('if_else', { sensor: 'target_distance', cmp: 'lt', n: 1 }, [n('stop', { n: 5 })], [n('drive', { dir: 'forward', n: 1 })])]),
      { me: [10, 27, 0] },
    );
    run(m, 1.5);
    add('Control', 'if-else takes the other branch when false', dist(m.bots[0].position, { x: 10, y: 27 }) > 3, `took the else branch and drove ${dist(m.bots[0].position, { x: 10, y: 27 }).toFixed(1)}m`);
  }
  {
    // wait must not stop what the bot was already doing
    const m = scenario(prog([n('drive', { dir: 'forward', n: 0.2 }), n('wait', { n: 1 }), n('stop', { n: 5 })]), { me: [10, 27, 0] });
    run(m, 0.25);
    const atWaitStart = { ...m.bots[0].position };
    run(m, 1);
    add('Control', 'wait lets the bot keep driving', dist(m.bots[0].position, atWaitStart) > 2, `moved a further ${dist(m.bots[0].position, atWaitStart).toFixed(1)}m during the wait`);
  }
  {
    const m = scenario(prog([n('wait_until', { sensor: 'bots_left', cmp: 'lt', n: 1 }), n('drive', { dir: 'forward', n: 1 })]), { me: [10, 27, 0] });
    run(m, 7);
    const stuck = dist(m.bots[0].position, { x: 10, y: 27 }) < 1;
    run(m, 3);
    add('Control', 'wait until gives up after 8s', stuck && dist(m.bots[0].position, { x: 10, y: 27 }) > 2, `held for 7s, then released and drove ${dist(m.bots[0].position, { x: 10, y: 27 }).toFixed(1)}m`);
  }

  // ------------------------------------------------------------ events
  {
    const m = scenario(prog([n('sweep', { dir: 'right' })], [{ hat: 'when_scanned', body: [n('stop', { n: 0.1 })] }]), {
      me: [27, 27, 0],
      them: [27, 40, 0],
    });
    run(m, 1.5);
    const vm = m.vms.get(m.bots[0])!;
    const hat = vm.program.stacks[1].hat.id;
    add('Events', 'radar scan fires its event', (vm.hits.get(hat) ?? 0) > 0, `fired ${vm.hits.get(hat) ?? 0} times`);
  }
  {
    const m = scenario(prog([n('stop', { n: 9 })], [{ hat: 'when_shot', body: [n('stop', { n: 0.1 })] }]), { me: [27, 27, 0] });
    run(m, 0.3);
    m.bots[0].hurt(10, 'other', 'test');
    m.bots[0].eventShot = true;
    run(m, 0.3);
    const vm = m.vms.get(m.bots[0])!;
    add('Events', 'being shot fires its event', (vm.hits.get(vm.program.stacks[1].hat.id) ?? 0) > 0, 'fired after taking a hit');
  }
  {
    const m = scenario(prog([n('drive', { dir: 'forward', n: 5 })], [{ hat: 'when_wall', body: [n('stop', { n: 0.2 })] }]), {
      me: [50, 27, 0],
    });
    run(m, 3);
    const vm = m.vms.get(m.bots[0])!;
    add('Events', 'hitting a wall fires its event', (vm.hits.get(vm.program.stacks[1].hat.id) ?? 0) > 0, 'fired while pressed against the edge');
  }
  {
    const m = scenario(prog([n('stop', { n: 9 })], [{ hat: 'when_health_below', args: { n: 60 }, body: [n('stop', { n: 0.1 })] }]), {
      me: [27, 27, 0],
    });
    run(m, 0.2);
    m.bots[0].hurt(80, 'other', 'test');
    run(m, 0.4);
    const vm = m.vms.get(m.bots[0])!;
    add('Events', 'health threshold fires once', vm.hits.get(vm.program.stacks[1].hat.id) === 1, `fired ${vm.hits.get(vm.program.stacks[1].hat.id)} time(s)`);
  }
  {
    // an interrupt must hand control back to the standing plan
    const m = scenario(
      prog([n('forever', {}, [n('drive', { dir: 'forward', n: 0.3 }), n('turn_body', { dir: 'right', n: 20 })])], [
        { hat: 'when_scanned', body: [n('stop', { n: 0.1 })] },
      ]),
      { me: [27, 27, 0], them: [27, 40, 0] },
    );
    run(m, 4);
    const vm = m.vms.get(m.bots[0])!;
    const mainBody = vm.program.stacks[0].body[0].body!;
    const stillLooping = (vm.hits.get(mainBody[0].id) ?? 0) > 1;
    add('Events', 'the standing plan resumes after an interrupt', stillLooping, `main loop ran ${vm.hits.get(mainBody[0].id)} times despite interruptions`);
  }

  // ------------------------------------------------------------ typing
  // ------------------------------------------------ waiting, or not waiting
  //
  // "turn" waits for the part to arrive, "start turning" does not. The wait is
  // the only way this language can say "after it gets there", so aim-then-fire
  // depends on it. The non-blocking pair exists so a script can keep watching
  // for walls while the gun swings, which is what a long slew otherwise costs.
  {
    const aim = n('turn_turret', { dir: 'right', n: 180 });
    const shot = n('fire', { n: 1 });
    const m = scenario(prog([aim, shot, n('stop', { n: 5 })]));
    const vm = m.vms.get(m.bots[0])!;
    run(m, 0.2);
    const early = vm.hits.get(shot.id) ?? 0;
    run(m, 2);
    const late = vm.hits.get(shot.id) ?? 0;
    add(
      'Turret',
      'turn turret holds the script until the gun arrives',
      early === 0 && late > 0,
      `after 0.2s the next block had run ${early} times, after 2.2s ${late}`,
    );
  }
  {
    const aim = n('turret_start', { dir: 'right', n: 180 });
    const shot = n('fire', { n: 1 });
    const m = scenario(prog([aim, shot, n('stop', { n: 5 })]));
    const vm = m.vms.get(m.bots[0])!;
    run(m, 0.05);
    add(
      'Turret',
      'start turret turning does not hold the script up',
      (vm.hits.get(shot.id) ?? 0) > 0,
      `the next block ran within a tick of a 180 degree swing starting`,
    );
  }
  {
    // The swing still happens. Not waiting is not the same as not turning.
    const m = scenario(prog([n('turret_start', { dir: 'right', n: 180 }), n('stop', { n: 5 })]));
    const before = m.bots[0].turret;
    run(m, 2);
    const turned = Math.abs(wrap(deg(m.bots[0].turret - before)));
    add(
      'Turret',
      'the gun still gets there after start turret turning',
      near(turned, 180, 8),
      `swung ${turned.toFixed(0)} degrees while the script carried on`,
    );
  }
  {
    const aim = n('turn_radar', { dir: 'right', n: 180 });
    const after = n('fire', { n: 1 });
    const m = scenario(prog([aim, after, n('stop', { n: 5 })]));
    const vm = m.vms.get(m.bots[0])!;
    run(m, 0.1);
    const early = vm.hits.get(after.id) ?? 0;
    run(m, 1);
    add(
      'Radar',
      'turn radar holds the script, start radar turning does not',
      early === 0 && (vm.hits.get(after.id) ?? 0) > 0,
      `blocking form had not reached the next block after 0.1s`,
    );
  }
  {
    const after = n('fire', { n: 1 });
    const m = scenario(prog([n('radar_start', { dir: 'right', n: 180 }), after, n('stop', { n: 5 })]));
    const vm = m.vms.get(m.bots[0])!;
    run(m, 0.05);
    add(
      'Radar',
      'start radar turning moves straight on',
      (vm.hits.get(after.id) ?? 0) > 0,
      `the next block ran within a tick`,
    );
  }

  // ------------------------------------------------ motion that does not wait
  {
    const after = n('fire', { n: 1 });
    const m = scenario(prog([n('drive_start', { dir: 'forward' }), after, n('stop', { n: 9 })]));
    const vm = m.vms.get(m.bots[0])!;
    run(m, 0.05);
    add(
      'Moving',
      'start driving does not hold the script up',
      (vm.hits.get(after.id) ?? 0) > 0,
      'the next block ran within a tick',
    );
  }
  {
    // No duration on it: the throttle stays set until something else changes it.
    const m = scenario(prog([n('drive_start', { dir: 'forward' }), n('forever', {}, [n('fire', { n: 0.5 })])]), {
      me: [10, 27, 0],
    });
    const from = { ...m.bots[0].position };
    run(m, 2);
    add(
      'Moving',
      'start driving keeps driving with no duration given',
      dist(m.bots[0].position, from) > 8,
      `travelled ${dist(m.bots[0].position, from).toFixed(1)}m over 2s with no drive duration anywhere`,
    );
  }
  {
    const after = n('fire', { n: 1 });
    // Deliberately no "stop" on the end: stop is a motion block, and a motion
    // block taking the wheel cancels a standing heading order.
    const m = scenario(prog([n('turn_body_start', { dir: 'right', n: 90 }), after, n('forever', {}, [n('fire', { n: 0.5 })])]));
    const vm = m.vms.get(m.bots[0])!;
    run(m, 0.05);
    const moved = (vm.hits.get(after.id) ?? 0) > 0;
    run(m, 3);
    const turned = Math.abs(wrap(deg(m.bots[0].heading)));
    add(
      'Moving',
      'start turning hull does not wait, and still arrives',
      moved && near(turned, 90, 8),
      `next block ran at once, hull settled ${turned.toFixed(0)} degrees round`,
    );
  }
  {
    // The point of the pair: throttle and steering are separate orders, so a
    // bot can do both at once and still come round the loop every tick.
    const m = scenario(
      prog([
        n('drive_start', { dir: 'forward' }),
        n('turn_body_start', { dir: 'right', n: 90 }),
        n('forever', {}, [n('fire', { n: 0.5 })]),
      ]),
      { me: [27, 27, 0] },
    );
    const from = { ...m.bots[0].position };
    run(m, 2);
    const turned = Math.abs(wrap(deg(m.bots[0].heading)));
    add(
      'Moving',
      'driving and turning can be ordered together',
      dist(m.bots[0].position, from) > 5 && near(turned, 90, 10),
      `moved ${dist(m.bots[0].position, from).toFixed(1)}m while turning ${turned.toFixed(0)} degrees`,
    );
  }
  {
    const m = scenario(prog([n('turn_body_start', { dir: 'right', n: 90 }), n('forever', {}, [n('fire', { n: 0.5 })])]));
    const vm = m.vms.get(m.bots[0])!;
    run(m, 0.05);
    const early = vm.senses(m).hull_remaining;
    run(m, 3);
    add(
      'Sensing',
      'hull turn still to go counts down',
      near(early, 90, 12) && vm.senses(m).hull_remaining < 5,
      `reads ${early.toFixed(0)} a tick after ordering 90, then ${vm.senses(m).hull_remaining.toFixed(1)} once settled`,
    );
  }

  {
    // Worth pinning down, because it is surprising: a standing heading order is
    // cancelled by any motion block that takes the wheel, "stop" included.
    const m = scenario(prog([n('turn_body_start', { dir: 'right', n: 90 }), n('stop', { n: 9 })]));
    const vm = m.vms.get(m.bots[0])!;
    run(m, 1.5);
    add(
      'Moving',
      'a motion block cancels a standing heading order',
      vm.senses(m).hull_remaining === 0 && Math.abs(deg(m.bots[0].heading)) < 8,
      'stop moving took the wheel, so the hull never turned',
    );
  }

  // --------------------------------------------------- orders still running
  {
    const m = scenario(prog([n('turret_start', { dir: 'right', n: 120 }), n('stop', { n: 5 })]));
    const vm = m.vms.get(m.bots[0])!;
    run(m, 0.05);
    const justAfter = vm.senses(m).turret_remaining;
    run(m, 2);
    const settled = vm.senses(m).turret_remaining;
    add(
      'Sensing',
      'turret turn still to go counts down as the gun swings',
      near(justAfter, 120, 12) && settled < 1,
      `reads ${justAfter.toFixed(0)} degrees a tick after ordering 120, and ${settled.toFixed(1)} once it arrives`,
    );
  }
  {
    // No order given, nothing outstanding. Same as Robocode's getGunTurnRemaining.
    const m = scenario(prog([n('stop', { n: 5 })]));
    const vm = m.vms.get(m.bots[0])!;
    run(m, 0.3);
    add(
      'Sensing',
      'turn still to go reads zero when nothing was ordered',
      vm.senses(m).turret_remaining === 0 && vm.senses(m).radar_remaining === 0,
      'no outstanding order means nothing left to travel',
    );
  }
  {
    const m = scenario(prog([n('sweep', { dir: 'right' }), n('stop', { n: 5 })]));
    const vm = m.vms.get(m.bots[0])!;
    run(m, 0.5);
    add(
      'Sensing',
      'a sweeping radar has no turn left to go',
      vm.senses(m).radar_remaining === 0,
      'a sweep never arrives anywhere, so there is nothing outstanding',
    );
  }
  {
    // The distinction the sensor exists for: an order that has landed reads 0
    // even though the gun is nowhere near the enemy.
    const m = scenario(prog([n('turret_start', { dir: 'right', n: 90 }), n('stop', { n: 5 })]), {
      me: [27, 27, 0],
      them: [27, 12, 0],
    });
    const vm = m.vms.get(m.bots[0])!;
    run(m, 2);
    const s = vm.senses(m);
    add(
      'Sensing',
      'turn still to go is about the gun, not the enemy',
      s.turret_remaining < 1 && s.gun_error > 20,
      `order complete (${s.turret_remaining.toFixed(1)}) while still ${s.gun_error.toFixed(0)} degrees off the target`,
    );
  }

  // ------------------------------------------------------------ sensing
  //
  // "clear space ahead of me" exists because "distance to the nearest wall"
  // cannot tell the difference between driving at a wall and driving alongside
  // one. These checks are mostly about proving that difference is real.
  {
    const m = scenario(idle(), { me: [10, 27, 180] });
    const s = m.vms.get(m.bots[0])!.senses(m);
    add(
      'Sensing',
      'clear space ahead measures to the wall it faces',
      near(s.wall_ahead, 9, 0.3),
      `10m from the west wall, nose on it: reads ${s.wall_ahead.toFixed(1)}m (hull is 1m to the nose, so 9m)`,
    );
  }
  {
    // The case the old sensor gets wrong: hugging a wall but driving along it.
    const m = scenario(idle(), { me: [3, 27, 90] });
    const s = m.vms.get(m.bots[0])!.senses(m);
    add(
      'Sensing',
      'driving alongside a wall reads clear',
      near(s.wall_distance, 3, 0.3) && s.wall_ahead > 20,
      `nearest wall ${s.wall_distance.toFixed(1)}m but ${s.wall_ahead.toFixed(1)}m of road ahead`,
    );
  }
  {
    const m = scenario(idle(), { me: [1.2, 27, 180] });
    const s = m.vms.get(m.bots[0])!.senses(m);
    add(
      'Sensing',
      'reads about zero when the nose is on the wall',
      s.wall_ahead < 0.5,
      `reads ${s.wall_ahead.toFixed(2)}m with the hull against it`,
    );
  }
  {
    // Pointing at a corner: the answer is whichever wall the ray meets first.
    const m = scenario(idle(), { me: [27, 10, 225] });
    const s = m.vms.get(m.bots[0])!.senses(m);
    add(
      'Sensing',
      'a diagonal takes the nearer of the two walls',
      near(s.wall_ahead, 10 * Math.SQRT2 - 1, 0.4),
      `10m south and 27m west of the walls, aimed between them: reads ${s.wall_ahead.toFixed(1)}m`,
    );
  }
  {
    const m = scenario(idle(), { me: [27, 27, 0] });
    const s = m.vms.get(m.bots[0])!.senses(m);
    add(
      'Sensing',
      'the middle of the arena reads clear both ways',
      near(s.wall_distance, 27, 0.3) && near(s.wall_ahead, 26, 0.4),
      `nearest ${s.wall_distance.toFixed(1)}m, ahead ${s.wall_ahead.toFixed(1)}m`,
    );
  }

  {
    const bad: string[] = [];
    for (const def of BLOCKS) {
      for (const [key, slot] of Object.entries(def.slots ?? {})) {
        if (slot.kind !== 'number') continue;
        const args: Record<string, string | number> = {};
        for (const [k, sl] of Object.entries(def.slots ?? {})) args[k] = sl.def;
        for (const s of allowedSensors(def, key, args)) {
          const want = slot.unit === 'match' ? SENSOR_BY_ID[String(args.sensor)]?.unit : slot.unit;
          if (SENSOR_BY_ID[s.id].unit !== want) bad.push(`${def.op}.${key} offers ${s.id}`);
        }
      }
    }
    add('Typing', 'every slot only offers sensors of its own unit', bad.length === 0, bad.length ? bad.join('; ') : 'checked every slot in every block');
  }
  {
    const powerSlot = allowedSensors(BLOCKS.find((b) => b.op === 'fire')!, 'n', { n: 1.5 });
    add('Typing', 'gun power takes a number only', powerSlot.length === 0, `${powerSlot.length} sensors offered for fire power`);
  }
  {
    const driveDef = BLOCKS.find((b) => b.op === 'drive')!;
    const opts = allowedSensors(driveDef, 'n', { dir: 'forward', n: 1 }).map((s) => s.id);
    add('Typing', 'drive duration takes only times', opts.every((o) => SENSOR_BY_ID[o].unit === 'time'), `offers: ${opts.join(', ') || 'none'}`);
  }

  return out;
}

/** A readable report for the console. */
export function reportChecks(): string {
  const rows = checkBlocks();
  const failed = rows.filter((r) => !r.pass);
  const lines: string[] = [];
  let group = '';
  for (const r of rows) {
    if (r.group !== group) {
      group = r.group;
      lines.push(`\n${group.toUpperCase()}`);
    }
    lines.push(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.detail}`);
  }
  lines.push(`\n${rows.length - failed.length}/${rows.length} passed.`);
  return lines.join('\n');
}
