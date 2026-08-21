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

### 2.1 Settle the sense-and-act rule — **done: restated, not enforced**

`drive at the target`, `back away from the target`, `circle the target` and
`point hull at the target` all sense *and* act. They re-steer off the target
every tick. The stated rule is already bent, and the bend has a cost: a bot
cannot escape a wall and circle in the same lap, because circling re-aims off the
target and throws away the heading the escape just set.

**Decided: restate.** The rule governs reporters and the turret, which is where
the interesting decisions live. The four movement blocks stay as they are, and
their help text now says plainly that they keep steering, so nobody has to lose
a battle to find out.

Two reasons. Steering a hull onto a bearing without arithmetic needs a feedback
loop and the language has no variables to hold one, so a "dumb" `circle the
target` would be a block that cannot do its own job. And this session has
already demonstrated once, with measurements, what changing a load-bearing
default does to a corpus of scripts.

What the player gets instead is the ability to **build** the steering blocks out
of parts, which arrived with 2.2b below: `start turning hull right by
[hull: how far to turn] + 70` is `circle the target`, assembled by hand, and
unlike the built-in it does not fight a wall escape.

### 2.2 Route A — **done, but not the way this said**

The plan was to flip the default: make `turn turret` and `turn radar` return
immediately, with `and wait` variants for scripts that need to block. The claim
was "no saved script breaks structurally, they just loop faster."

**That claim was wrong, and the bench caught it before any of it shipped.**
Flipping the default gutted every bot on the roster:

| | shots fired | damage dealt |
| --- | --- | --- |
| Hunter | 7 → 3 | 61 → 48 |
| Orbit | 8 → 3 | 30 → 15 |
| Coward | 6 → 2 | 10 → 4 |
| Starter | 28 → 27 | 20 → 13 |

The reason is that a block finishing is the only way this language can say
"after it gets there". Aim-then-fire depends on it. Hunter does gate its shot on
`turret: how far off target`, but with a non-blocking turn the aim and the check
land in the same tick, before the turret has moved at all, so the gate reads the
very error the aim was meant to remove. Making only the radar non-blocking was
worse again.

So the default is unchanged and the new behaviour is opt-in:

- `turn turret {dir} by {n}` and `turn radar {dir} by {n}` wait, exactly as
  before. Every saved script and every rival is untouched.
- `start turret turning {dir} by {n}` and `start radar turning {dir} by {n}` are
  new, and do not wait.

This also gives the language a rule worth having, one it half had already through
`start sweeping radar`: **"start" never waits, "turn" always does.**

The payoff is real where it matters. Same bot, one block swapped, 50 battles:

| | turn turret (waits) | start turret turning |
| --- | --- | --- |
| Won | 52% | **80%** |
| Wall damage per battle | 4.2 | **0.1** |
| Damage taken | 81 | **51** |
| Accuracy | 16% | **20%** |

It aims *better*, not worse, because it re-aims every tick instead of committing
to one stale angle and waiting for it.

Wallwise is rebuilt on it: 15 blocks down to 11, and the `stop for 0.05` that
existed only to clear the sticky throttle before a slow aim is gone, because
aiming no longer holds anything up.

#### What Robocode does about the same problem

Checked against the Robocode source rather than memory, because it has had
twenty years to get this wrong and didn't.

It made the same split. `Robot` has blocking calls, `AdvancedRobot` adds
`setAhead`, `setTurnGunRight`, `setFire`, which "return immediately, and will not
execute until you call `execute()`". Every serious bot is an `AdvancedRobot`, and
the official guidance is that calling `fire()` inside `onScannedRobot` is slow
and you should call `setFire()`. So they did not design starvation away
mechanically. They made the non-blocking path the idiom and documented it. Our
rivals do the opposite: Hunter runs `charge`, a 1.4 second blocking block, inside
`when my radar passes over a bot`.

The structural difference is `execute()`. It is a turn boundary: handlers set
their commands and return, the main loop sets its own, and both contribute to the
same turn. They never compete for time, so nothing can starve. We have no such
boundary, which is the whole of the difference.

Their event priorities are the same shape as ours, with the most frequent event
lowest: ScannedRobotEvent 10, HitByBulletEvent 20, HitWallEvent 30. Ours runs
`when_scanned` at 3 under the collision hats at 4. Nothing to change there.

**What this means for Route B.** Starvation is not what I thought. The standing
plan's share of executions barely moved either way. What starves it is interrupt
stacks firing constantly, not turret blocks holding it up. Route B should be
judged on that, not on the turret.

Robocode is also evidence against Route B outright. It never needed concurrent
stacks: one thread, non-blocking actions, and a turn boundary as the
synchronisation point was enough. The cheaper thing to try first is extending
`start` to the motion blocks so a standing plan can command everything without
ever blocking.

### 2.2a Turn-still-to-go sensors — **done, and only a partial win**

Robocode's `getGunTurnRemaining()` is what makes its non-blocking aiming usable:
the canonical bot fires on `Math.abs(getGunTurnRemaining()) < 10` rather than on
a live angle to the enemy. Added the equivalents, `turret: turn still to go` and
`radar: turn still to go`.

Benched three ways at 50 to 100 battles. The result is smaller than the analogy
suggested, and the reason is instructive.

With aim and fire in the same loop, the new sensor changes nothing: 76% wins
either way, 51 against 49 damage dealt, but 66 shots at 11% accuracy against 38
shots at 19%. Same outcome, twice the ammunition.

With the aim in a `when my radar passes over a bot` stack and the shot in the
standing plan, which is Robocode's own shape, it does help: damage dealt 41 to
51 across 80 battles.

**Why it matters less for us.** Robocode needs the remaining-turn trick because
enemy position is only fresh inside the handler. Our contacts persist and carry
an age, so `turret: how far off target` is live every tick. We already had the
better sensor for the common case; this one answers the narrower question of
whether a commanded swing landed. Kept because it is four lines, purely
additive, and it is the only way to ask that question, but the help text now
says plainly that the other sensor is usually the right gate.

### 2.3 Route B: three concurrent stacks — **not done, deliberately**

**Not built, and the evidence says it should not be.** See 2.2b: a standing plan
written entirely out of non-blocking orders already runs every single tick, with
the plan taking 100% of executions and roughly 50,000 block runs per battle
against Wallwise's previous 1,958. There is nothing left for concurrency to fix,
and Robocode reached the same place with one thread twenty years ago.

The migration cost below is the reason to care. It buys a property we now get
for free.

The original design is kept below for the record.

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

### 2.2b Motion that does not wait — **done, and this is what replaced Route B**

Robocode's answer to a starving main loop is not concurrency. It is that every
action is non-blocking and the turn boundary is the synchronisation point. So
rather than three stacks, the motion channel got the same treatment the turret
got in 2.2:

- `start driving {dir}` — sets the throttle and returns. No duration; it runs
  until another motion block changes it. Unlike `drive for`, it leaves the
  steering alone.
- `start turning hull {dir} by {n}` — points the hull at a heading and returns,
  holding that heading while the rest of the script runs.
- `hull: turn still to go` — completes the set with the turret and radar ones.

Because they leave each other alone, they compose: a plan can order throttle and
heading in the same lap and still come round every tick to look at the world. A
`forever` loop of nothing but orders runs one lap per tick, which is exactly
Robocode's `run()` loop with `execute()` at the bottom.

**Measured.** A plan built this way runs about 50,000 blocks a battle against
1,958 for the previous Wallwise, and the standing plan's share of executions is
100%. Starvation is simply gone.

It also produced the strongest bot so far. Wallwise is rebuilt as a true
orbiter: drive continuously, steer to the target's bearing plus 70 degrees, turn
away at 22 metres of clear space, aim and fire every tick. **96% wins over 100
battles** against Hunter and Orbit, up from 68%, dealing 71 damage a battle
against 49.

One honest note: the first non-blocking bot I wrote was *worse* than the
blocking one, 43% against 68%, because driving continuously in a straight line
is easy to shoot. The machinery gives a tight control loop; spending it well is
still the player's job. That is the game working as intended.

A surprise worth writing down: `stop moving` cancels a standing heading order,
because any motion block that takes the wheel clears it. There is a check
pinning that down and the help text says so.

---

## Phase 3 — Depth and progression

### 3.1 Derived sensors — **done, with one deliberately left out**

The skill ceiling plateaus because the language has no memory and no arithmetic,
so leading a shot cannot be expressed. A power 3 round crawls at 10 m/s against
bots moving at 8, so leading *should* be the master skill.

Not variables. Sensors that do the differencing:

- `the target's speed`
- `is the target getting closer` (signed, so it can drive a turn)
- `how far ahead to aim` (angle, signed)

**Built the first two, left out the third.** `the target's speed` and `how fast
the gap is closing`, the second being the relative velocity projected onto the
line between the two bots, worked out at the moment of the scan.

The lead angle is out on a mechanical ground rather than a taste one: a number
slot takes one sensor plus a constant, not two sensors. There is no way to add a
lead to `turret: how far to turn` in a slot, so shipping a lead angle would mean
also shipping a pre-combined aiming sensor, and that is the auto-aim block this
design removed on purpose. The raw materials are there instead: speed and range
are what a player needs to work out their own constant offset.

- `src/bot.ts` — `see()` records a snapshot; it needs to record the target's
  velocity too.
- `src/blocks.ts`, `src/vm.ts`, `src/checks.ts` as with any sensor.

### 3.2 Rival ladder — **done**

The five rivals are a difficulty curve presented as a flat menu. Each one teaches
something specific: Lamppost teaches aiming, Pacer teaches leading, Orbit teaches
radar tracking, Coward teaches closing, Hunter teaches escape.

- `src/program.ts` — order and a one line lesson per rival.
- `src/storage.ts` — which rivals have been beaten.
- `src/workshop.ts` — locked entries, and the lesson shown on the card.

A tutorial that never opens a tutorial window.

Order: Lamppost, Coward, Pacer, Orbit, Hunter. Everything in the arena counts
towards a win, so beating three at once climbs three rungs. A save from before
this existed has no beaten list and gets the whole roster, because a returning
player should not find four opponents taken away.

### 3.3 Challenge links — **done**

Static hosting, no backend, so put the script in the URL.

- `src/storage.ts` — encode with `CompressionStream('deflate-raw')` plus
  base64url. Built into the browser, no dependency, fits the no-library habit.
- `src/main.ts` — read `location.hash` on load, run it through `cleanProgram`
  exactly like an imported file, and ask before replacing the current script.

Measured: the starter script is a 381 character link, Hunter 515, and a
deliberately absurd 192 block script still only reaches 1973. Anything past 8000
is refused with a message rather than silently truncated.

**Corrected after shipping.** The first version loaded a shared bot into the
recipient's editor, which handed over the source. That breaks the one rule this
game has always kept: a rival's script cannot be read. A challenger now goes
straight into the battle list and never touches the editor, so it can be fought
and not opened. Verified from a clean profile: the editor is untouched, and the
challenger's blocks appear nowhere in the script canvas, the battle card or the
arena inspector.

**Extended again.** Up to five sent bots are kept, each benchable, and the
player can take their own bot out of the arena so two of them fight each other.
`Match.player` became nullable to make that safe: it used to fall back to the
first bot, which would have handed the inspector a challenger's program the
moment the player sat out. Everything wanting "the player" now has to say what
it does when there isn't one, and the inspector's answer is to render nothing.

A single bot alone is a practice run: it holds the clock open instead of
declaring the last one standing a winner the moment the battle starts. Measured
that the `isPlayer` flag touches nothing in the simulation, 20 battles a side,
so watching a fight gives the same result as being in one.

Rival scripts stay uncopyable. This is for player against player, which is a
different thing.

---

## Phase 4 — Feel

### 4.1 Audio — **done**

There is no audio at all today, which is a lot of free feedback left on the table
for a game whose core activity is watching.

- `src/audio.ts` — new. Synthesise with WebAudio, no asset files. Keeps the
  static host and the small bundle intact.
- The gun's thump, pitched by shot power. A hit tick. The heat lockout click,
  which matters most: firing while hot silently does nothing today, and the
  player has no way to perceive that failure.
- Needs a user gesture to unlock the audio context. The Fight button is the
  natural place.

### 4.2 Kill feed — **done**

Damage happens off screen constantly and the only trace is a health bar moving.

- `src/match.ts` — a short rolling list of events.
- `src/hud.ts` — three or four lines, faded, bottom corner.

Reads off a new event stream on `Match`, which the audio shares, so neither has
to hook every damage site separately.

---

## What was left undone, and why

**Route B, three concurrent stacks (2.3).** Deliberately not built. A standing
plan written out of non-blocking orders already runs every tick at 100% of
executions, so there is nothing left for concurrency to fix, and the migration
would have cost a storage version bump, a lossy autoconversion of every saved
script, and five rivals rewritten by hand. Robocode reached the same place with
one thread. The full design is kept above if the reasoning ever stops holding.

**The lead-angle sensor (3.1).** Blocked by the slot model, not by taste. See
above.

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
