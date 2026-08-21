# Dumb Clanker — Roadmap

Nine changes, grouped into four phases. The order is not the order of value.
It is the order that makes each step safe to take.

The governing decision: **build the measuring instrument first.** Phase 2 rewrites
how the language executes, and the only honest way to know whether that rewrite
made the game better is to be able to run a hundred battles and compare. So the
test bench comes before the thing it exists to validate.

---

## Phase 1 — Instrumentation and quick wins

Nothing here touches the VM's execution model. Every item ships on its own and
none of them can break a saved script.

### 1.1 Damage ledger — **done**

`hurt()` already takes a reason and throws it away unless the blow is fatal.
Keep a running total per reason instead.

- `src/bot.ts` — add `damageBy: Record<string, number>`, accumulate in `hurt()`.
  Normalise the reason to a category: shot, wall, ram.
- `src/hud.ts` — show the split on the result standings.

Everything else in Phase 1 and Phase 4 reads from this, so it goes first.
It is maybe thirty lines.

### 1.2 Test bench — **done**

Promote `__clanker.sim()` from a dev console toy to a player feature.

- `src/bench.ts` — new. Lift the battle loop out of `main.ts`. Runs a field N
  times with no renderer, returns win rate, average damage dealt and taken,
  average survival time, and the damage ledger totals.
- `src/workshop.ts` — a Test panel beside Battle. Pick a field, pick a number of
  battles, get a table.

Chunked with `setTimeout` and a progress bar, no worker needed. The estimate
above was wrong in both directions: a battle is about 2,700 ticks rather than
11,000 because most end well before the final bell, and a headless battle costs
about 40ms. `Match` gained a `headless` flag that skips sparks, smoke, screen
shake and the slow motion on a kill, which are the only things in the loop that
exist purely to be looked at. That roughly halved the cost.

Measured: **100 battles in 7 seconds.**

### 1.3 Sensor watch — **done**

Fifteen live numbers beside the script in the arena. `vm.senses(match)` already
computes the lot every tick and hands back a plain object, so this is mostly a
table and a formatter.

- `src/inspector.ts` — a collapsible panel, values updated on the existing tick.

### 1.4 Channel gauges — **done**

The sticky throttle is invisible hidden state and it catches everybody. Show it.

- `src/vm.ts` — expose `throttle`, `turn`, `turretTarget`, `radarSpin` through
  getters. They are private fields today.
- `src/inspector.ts` — three small persistent readouts: driving, turret, radar.

Worth doing even though Phase 2 may change what the channels mean. It is the
diagnostic that tells you whether Phase 2 worked.

### 1.5 Never-true branch counter — **done**

The `never` marker on cold blocks is the best thing in the inspector. Extend the
same idea to conditions.

- `src/vm.ts` — tally how often each `if` and `if else` was tested and how often
  it was true.
- `src/inspector.ts` — the block reads `7× · never true` and greys out like a
  block that never ran, because everything inside it is dead either way.

Fixed a copy bug found while testing this: `slotSuffix` appended the unit label
to blocks that already name their own unit, giving "fire with power 3 power" and
"repeat 4 bots times". An empty suffix is now a real answer rather than a missing
one.

The *starvation* warning I wanted alongside this is deliberately deferred. If
Phase 2 lands, starvation stops being a thing that can happen, and building an
elaborate warning for a bug that is about to be designed out is wasted work.

### 1.6 Wall-ahead sensor — **done**

`distance to the nearest wall` cannot tell "about to hit that" from "driving
comfortably parallel to it". Add the one that can.

- `src/blocks.ts` — new sensor, `metres to the wall ahead of me`, unit distance.
- `src/vm.ts` — analytic ray against the arena rectangle along the hull heading.
  Four line intersections, no physics query needed.
- `src/checks.ts` — a check that drives at a known wall from a known distance and
  confirms the reading falls as expected.

Benched at 60 battles a side, two bots identical except the sensor, both
turning away at 14 metres:

| | nearest wall | clear ahead |
| --- | --- | --- |
| Won | 53% | **73%** |
| Wall damage per battle | 0.9 | **0.1** |
| Damage taken per battle | 127 | **73** |
| Seconds alive | 83 | **155** |

The payoff is not a smaller margin, which is what I expected when writing this.
It is that the same margin costs far less. At 14 metres the omnidirectional
sensor is true over about half the arena, so the bot spends its life turning
away from walls it was never going to hit. The directional one only fires when
the bot is actually pointed at something.

Wallwise is rebuilt on it: 24 blocks down to 15, and the reverse-out-of-trouble
branch and the `when I run into a wall` backstop are both gone as dead weight.

---

## Phase 2 — The language change

This is the one that matters and the one that can go wrong. Do it while the
script corpus is still small.

### 2.1 Settle the sense-and-act rule first (design, no code)

`drive at the target`, `back away from the target`, `circle the target` and
`point hull at the target` all sense *and* act. They re-steer off the target
every tick. The stated rule is already bent, and the bend has a cost: a bot
cannot escape a wall and circle in the same lap, because circling re-aims off the
target and throws away the heading the escape just set.

Pick one before writing any VM code, because it decides what these blocks become:

- **Restate the rule** as applying to reporters only, and keep the steering
  blocks as they are.
- **Make them dumber.** They set a heading once and drive, and the player repeats
  them to track. More honest, more blocks to write, more in the spirit of the
  language.

### 2.2 Route A: stop turret and radar blocks blocking (medium)

**Do this first, and measure before going further.**

Make `turn turret`, `turn radar` and `sweep` set their target and return
immediately rather than occupying the bot until they arrive. Add explicit
`and wait` variants for when a script genuinely needs to block.

- `src/vm.ts` — `startAction` returns null for these instead of an Action.
- `src/blocks.ts` — the waiting variants, and help text that says which is which.

A fraction of the work of Route B, and it captures most of the benefit. The
standing plan stops starving, the wall check stops going stale inside a turret
slew, and no saved script breaks structurally. Scripts change behaviour, they
just loop faster.

Then run the Phase 1 bench across the rival roster. If starvation is gone and the
scripts read clearly, Route B may not be needed at all.

### 2.3 Route B: three concurrent stacks (large, only if still wanted)

One standing plan and one interrupt slot *per channel* rather than for the bot as
a whole. Today's model is exactly this with a single channel, so it generalises
rather than replaces.

- **Stacks get a channel.** Driving, turret, radar. Only blocks of that category
  go in, enforced by the editor, in the same way number slots are typed today.
  Control blocks are neutral and allowed anywhere.
- **Event hats get a channel too.** `when a bullet hits me (driving)` and
  `when a bullet hits me (turret)` are two stacks. Duplicate hats are already
  legal, so this needs no new concept.
- **Priority stays, per channel.** The interrupt logic is unchanged, it just runs
  three times.
- `src/vm.ts` — `base` and `interrupt` become three of each. `applyChannels`
  merges three actions instead of switching on one.
- `src/editor.ts` — three columns, channel filtering on the palette.

**The migration cost is real and should not be hidden.** An old standing plan is
a single stack of mixed blocks whose interleaving is meaningful, and splitting it
by category loses that. Plan for:

- `src/storage.ts` — bump to version 2. Convert on load by splitting the standing
  plan by category in source order, and say plainly in the UI that the script was
  converted and should be checked.
- Rewrite the five rivals by hand. Autoconversion is not good enough for the
  scripts the game ships.
- Rewrite Wallwise and Apex.
- `src/checks.ts` — new checks covering two channels acting at once.

Use the bench to confirm each rewritten rival performs the way it did before.
That comparison is the whole reason Phase 1 comes first.

---

## Phase 3 — Depth and progression

### 3.1 Derived sensors (medium, mostly a design call)

The skill ceiling plateaus because the language has no memory and no arithmetic,
so leading a shot cannot be expressed. A power 3 round crawls at 10 m/s against
bots moving at 8, so leading *should* be the master skill.

Not variables. Sensors that do the differencing:

- `the target's speed`
- `is the target getting closer` (signed, so it can drive a turn)
- `how far ahead to aim` (angle, signed)

The last one is the interesting call. It is the same move `turret: how far to
turn` already makes, handing over a computed angle and leaving the player to
decide when to use it. It may be too generous. It is the same instinct that cut
the auto-aim convenience blocks, so decide it deliberately rather than by
accident.

- `src/bot.ts` — `see()` records a snapshot; it needs to record the target's
  velocity too.
- `src/blocks.ts`, `src/vm.ts`, `src/checks.ts` as with any sensor.

### 3.2 Rival ladder (medium)

The five rivals are a difficulty curve presented as a flat menu. Each one teaches
something specific: Lamppost teaches aiming, Pacer teaches leading, Orbit teaches
radar tracking, Coward teaches closing, Hunter teaches escape.

- `src/program.ts` — order and a one line lesson per rival.
- `src/storage.ts` — which rivals have been beaten.
- `src/workshop.ts` — locked entries, and the lesson shown on the card.

A tutorial that never opens a tutorial window.

### 3.3 Challenge links (small)

Static hosting, no backend, so put the script in the URL.

- `src/storage.ts` — encode with `CompressionStream('deflate-raw')` plus
  base64url. Built into the browser, no dependency, fits the no-library habit.
- `src/main.ts` — read `location.hash` on load, run it through `cleanProgram`
  exactly like an imported file, and ask before replacing the current script.

Watch the URL length limit. If a large script overflows, say so rather than
producing a link that silently truncates.

Rival scripts stay uncopyable. This is for player against player, which is a
different thing.

---

## Phase 4 — Feel

### 4.1 Audio (medium)

There is no audio at all today, which is a lot of free feedback left on the table
for a game whose core activity is watching.

- `src/audio.ts` — new. Synthesise with WebAudio, no asset files. Keeps the
  static host and the small bundle intact.
- The gun's thump, pitched by shot power. A hit tick. The heat lockout click,
  which matters most: firing while hot silently does nothing today, and the
  player has no way to perceive that failure.
- Needs a user gesture to unlock the audio context. The Fight button is the
  natural place.

### 4.2 Kill feed (small)

Damage happens off screen constantly and the only trace is a health bar moving.

- `src/match.ts` — a short rolling list of events.
- `src/hud.ts` — three or four lines, faded, bottom corner.

Reads straight from the Phase 1 damage ledger.

---

## Order, condensed

1. Damage ledger
2. Test bench
3. Sensor watch, channel gauges, never-true counter
4. Wall-ahead sensor
5. Settle the sense-and-act rule
6. Non-blocking turret and radar, then measure
7. Three channel stacks, only if still wanted
8. Derived sensors, ladder, challenge links
9. Audio, kill feed

Phase 1 is safe and independently shippable. Phase 2 is the one to be careful
with. Phases 3 and 4 can be reordered freely to taste.
