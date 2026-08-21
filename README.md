# Dumb Clanker

A browser-based programming game. Write **Clank Script** to control a single
bot, then set it loose in the arena to find and defeat the competition.

### ▶ [Play it](https://sevin47.github.io/dumb-clanker/)

No install, no sign-up — it all runs in the browser.

Every bot in the game is mechanically identical. There is nothing to build and
nothing to buy — the only thing that makes your bot better than anyone else's is
the program you wrote for it.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173.

## The bot

One standard chassis with three things that turn **independently**:

- **The hull** drives and steers.
- **The turret** aims wherever you point it, whatever the hull is doing.
- **The radar** is a narrow 12° beam reaching 38m. It only reports a bot when the
  beam actually sweeps across one, so a script has to keep it moving — or hold it
  deliberately on somebody.

The arena is a **54m square** — about 27 bot-widths across — shown top-down in
full at all times, with start positions randomised every battle. **Every bot's
radar beam is drawn on the floor in its own colour**, so you can see not just
where you are looking but where everyone else is looking too.

Health is a single pool. Firing generates **gun heat** and you cannot fire again
until it cools. Heavier shots hurt more, fly slower, and lock the gun for longer:
a power-3 round crawls at 10 m/s against bots that move at 8, so heavy shots
genuinely miss anything that is not asleep.

## Clank Script

Scratch-shaped blocks dragged into stacks headed by a "when…" hat.

- **`when the match starts`** is your standing plan. Put a `forever` in it.
- **Every other hat is an interrupt** — it takes over, runs to the end, then your
  standing plan carries on from where it left off. One plan plus interrupts, so
  two stacks can never fight over the controls.
- Conditions are a fixed *sensor / comparison / value* triple, e.g.
  `if [distance to the target] [is less than] [10]`.
- **No block both senses and acts.** Nothing aims for you.
- **Amounts are typed.** Every number slot has a unit, and only sensors
  measuring that unit can drive it — so `fire with power` takes a plain number,
  `drive for` offers only times, and `turn` offers only angles. Nonsense like
  "drive forward for [bots still alive] seconds" is never offered.

**Any number slot can be driven by a sensor** instead of a fixed value, which is
how you build aiming out of parts. The three "turn needed" sensors are signed —
negative means left — so a turn block steers itself the right way:

```
turn radar right  [radar turn needed]      keep the beam on them
turn turret right [turret turn needed]     swing the gun on
if [how far my turret is off target] is less than [5]
  fire with power [1.2]
```

Each turn corrects **once**, so a moving target needs re-aiming every lap.

The starter script is deliberately weak — about 2 wins in 10 against the roster.
It shows the one pattern worth copying (sweep, and when the beam finds somebody,
swing the gun onto them and shoot) and does everything else badly, so there is
something left to work out. Rival scripts are **not** copyable.

Blocks are grouped by what they command: **Moving** (the hull), **Turret**,
**Radar**, plus **Events** and **Control**. Drag from the palette onto the gaps
that light up; drag one back to the palette to bin it.

The canonical shape of a working bot is three stacks:

```
when the match starts        when my radar spots a bot     when I hit a wall
  forever                      keep radar on the target      drive backward 0.8s
    sweep radar right          aim and fire with power 1.2   turn hull right 100°
    drive forward 1.2s         circle left for 0.9s
    turn hull right 40°
```

## Saving your work

Scripts **autosave as you edit** — a refresh, a crash or a closed tab never
costs work. The Scripts card in the workshop also keeps a named library: give a
script a name, hit **Save**, and load it back any time.

Saves live in your browser's local storage, which means they are per-browser and
a cleared cache takes them with it. **Export** writes a script to a
`.clank.json` file you can keep or send to somebody; **Import** reads one back.

Old saves are sanitised on load rather than trusted. The block vocabulary has
changed several times, so a script written against an older version loses the
blocks that no longer exist and keeps everything else, instead of failing to
open.

## The battle

Pick who is in the arena with you and how many — up to five opponents, and the
same one can go in more than once. Every rival is written in the blocks you
have, but you cannot read or copy their scripts. Work out what they are doing by
watching them.

A bot that runs out of health is removed from the arena, wreck and all. There is
nothing left to bump into and nothing left to shoot.

| Rival | What it does |
| --- | --- |
| **Lamppost** | Never moves. Perfect aim, and an easy target. |
| **Pacer** | Drives back and forth. Learns that moving *towards* people does not help. |
| **Hunter** | Locks radar, closes, fires heavy at point blank. |
| **Orbit** | Circles whatever it finds while tracking with radar and gun. |
| **Coward** | Keeps its distance and plinks with light, fast rounds. |

## Watching your script run

The panel down the left of the arena shows your script exactly as you wrote it,
with the block currently executing outlined in white. Every block carries a
running tally:

- `11× · 8%` — it ran eleven times and held the bot for 8% of the battle.
- **`never`** — it has not run at all. This is usually the actual bug: an event
  that never fires, or a branch whose test is never true. Blocks that never run
  are dimmed, and a warning appears if a whole stack has stayed cold.

## Controls

Nobody drives — the bots run their own programs. Everything is in the left panel:

| | |
| --- | --- |
| **Pause** (`Space`) | Freeze the battle. The script panel stays live, so you can read where it stopped. |
| **Step** (`.`) | Advance a single frame. |
| **0.5× / 1× / 2× / 4×** (`[` `]`) | Battle speed. Slow it down to watch a turret track; speed it up to reach the interesting part. |
| **Recall bot** (`C`) | Teleports your bot to a clear spot and restarts its script. For when it wedges itself in a corner, or the script talks itself into one. Not free: the gun comes back hot and everything it had scanned is forgotten. |
| **Run again** (`R`) | Same field, fresh battle, new random positions. |
| **Workshop** (`B`) | Back to the editor. |

## Testing a bot properly

One battle tells you almost nothing. Starting positions are random, an early
power-3 round decides a lot, and a script that looks broken in one match wins the
next three.

The **Test bench** in the workshop runs the same field 10, 30 or 100 times with
nothing drawn and averages the result: win rate, damage dealt and taken, time
alive, accuracy. A hundred battles takes about seven seconds.

Underneath it says what actually hurt you, split into shot, walls and ramming.
That is usually the useful line. A bot losing 40 health a battle to walls has a
movement problem, not an aiming problem, and nothing else on the screen tells you
that. The same split appears on the standings at the end of a normal battle.

## On a phone

The whole game works on a touch screen.

- **Tap to place.** Tap a block in the palette, then tap a gap in the script to
  drop it in. Tap a block already in the script to pick it up, then a gap to
  move it or the palette to bin it. A bar along the bottom says what you are
  holding and lets you cancel. Dragging still works where the browser supports
  it.
- **Three tabs** replace the three columns when the window is under 940px wide:
  Blocks, Script, Battle.
- **In the arena** the script panel slides over the battle instead of sitting
  beside it. The `Script` button top left opens and closes it.
- **The HUD grows.** Below 620px the readouts are laid out on a coarser grid, so
  health and heat come out at a readable size rather than eight pixels tall.

## Checking the blocks actually behave

Every block's help text says what it does *and when it finishes*. Those claims
are tested rather than asserted — run this in the dev console:

```js
__clanker.check();
```

It sets up controlled battles, runs one block at a time, and prints the measured
result against the documented one. 38 checks covering movement, the turret, the
radar, control flow, events and slot typing.

It earns its keep. On its first run it caught `turn hull left by 90` actually
turning **144°** — the block stopped counting once it had rotated far enough,
but the hull was still spinning and coasted on past. Turns now aim at a heading
and settle on it: the same block measures 91°.

## Tuning harness

Balance work here is impossible by hand, so the dev build exposes
`window.__clanker` for headless battles in the browser console:

```js
// your starter script against a named field
__clanker.quick('lamppost', 'hunter', 'orbit');
// -> { winner, reason, seconds, standings: [{ name, health, damage, shots, hits, note }] }
```

`note` reports a stalled program — an empty `forever`, or a script that ran too
long in one tick. `__clanker.sim(entrants)` takes a full entrant list if you want
to pit two authored scripts against each other directly.

`vite.config.ts` adds a dev-only `POST /__shot` endpoint that writes a rendered
frame to `shots/`, which is how the visuals get checked without a visible browser
window. Both the debug handle and the endpoint are dev conveniences and should be
stripped before this ships anywhere public.

## Deploying

Pushing to `main` builds the site and publishes it to GitHub Pages via
`.github/workflows/deploy.yml`. Nothing else is needed.

Two things make that work, and both bite if you forget them:

- `vite.config.ts` sets `base: '/dumb-clanker/'` for production builds, because
  Pages serves the project from a subpath. Dev still serves from `/`.
- The `window.__clanker` debug handle is wrapped in `import.meta.env.DEV`, so it
  is tree-shaken out of the shipped bundle rather than exposed publicly.

If the repo is ever renamed, the `base` path must be renamed with it.

## Layout

| File | Role |
| --- | --- |
| `src/spec.ts` | The standard bot, gun maths, arena size — every tuning lever |
| `src/blocks.ts` | The Clank Script block catalogue |
| `src/program.ts` | Program data model, starter script, rival scripts |
| `src/vm.ts` | The interpreter that runs a program each tick |
| `src/editor.ts` | Block editor: palette, drop gaps, drag and drop, tap to place |
| `src/bot.ts` | The bot: hull, turret, radar, health, gun heat |
| `src/match.ts` | Arena, bullets, radar sweeps, collisions, standings |
| `src/render.ts` | 3D scene, camera framing, compositing |
| `src/hud.ts` | HUD, field roster, result standings |
| `src/workshop.ts` | Workshop screen: editor plus battle setup |
| `src/inspector.ts` | Arena-side script view, live highlight, profiling, transport |
| `src/checks.ts` | Behaviour checks: what each block claims vs what it measures |
| `src/storage.ts` | Autosave, script library, import/export |
