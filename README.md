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
- **`7× · never true`** — the condition is being checked and has never once
  passed, so everything inside it is dead. This one hides well: the block looks
  busy on the tally while the code under it has never run.
- **`never`** — it has not run at all. This is usually the actual bug: an event
  that never fires, or a branch whose test is never true. Blocks that never run
  are dimmed, and a warning appears if a whole stack has stayed cold.

### The three channels

Under the script are three readouts: **driving**, **turret**, **radar**.

They are there because the channels persist. A drive block sets the throttle and
nothing clears it until another motion block runs, so a script that spends a
second swinging the turret spends that second driving as well. That is invisible
from reading the script and it is the single most common cause of a bot that
sails into a wall just after checking it was clear.

Underneath, **Sensors** opens a live list of all fifteen readings, so you can
watch what your script is actually deciding on.

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

### Waiting, or not waiting

`turn turret right by 45` **waits**. Nothing else in your script runs until the
gun arrives. That is what makes aim-then-fire work: by the time the next block
tests `turret: how far off target`, the turret has actually moved.

`start turret turning right by 45` does **not** wait. The next block runs
immediately while the gun keeps swinging on its own.

The rule across the language: **"start" never waits, "turn" always does.**

Waiting is not free. A 180 degree swing takes over a second, and during that
second your script is not checking anything, including walls, while the throttle
stays wherever the last drive block left it. That is the usual reason a bot
drives into a wall it had just checked was clear.

The non-blocking form has its own catch: the gun has not moved yet when the next
block runs, so testing `turret: how far off target` straight after starting a
swing reads the error you were trying to remove. Put both in a `forever` loop
and test on a later lap. Done that way it aims better than waiting does, because
it re-aims every tick instead of committing to one stale angle.

### Orders that wait, and orders that do not

Every action block that takes time comes in two forms.

`turn turret right by 45` and `drive forward for 1 second` **wait**. Nothing else
in your script runs until they finish. That is what makes aim-then-fire work:
by the time the next block tests the gun, the gun has moved.

`start turret turning right by 45`, `start radar turning`, `start driving
forward` and `start turning hull right by 90` do **not** wait. The next block
runs immediately while the part keeps going on its own.

**"start" never waits. "turn" and "drive for" always do.**

The non-blocking set is how you write a bot that watches the world constantly. A
`forever` loop containing nothing but orders runs one lap per tick, sixty times a
second, so your wall check is never more than a sixtieth of a second stale. The
blocking set is how you write a sequence, where one thing genuinely has to
finish before the next begins.

They also compose: `start driving` sets only the throttle and `start turning
hull` sets only the steering, so a bot can order both in the same lap and do
them at once. Any block that waits takes the wheel back and cancels a standing
heading, `stop moving` included.

### Two ways to ask about the gun

`turret: how far off target` measures the gun against **the enemy**. It is live
every tick and it is what you almost always want before firing.

`turret: turn still to go` measures the gun against **the heading you last sent
it to**. It reads 0 the moment that order completes, whether or not the enemy is
still there. Use it to ask "did the swing I asked for land", not "am I aimed".

Measured, the difference is real: a bot gating its shot on the second one fires
nearly twice as often at half the accuracy for the same damage. It earns its
place only when the aiming happens somewhere else in the script from the firing.

### Knowing where the walls are

There are two wall sensors and the difference matters.

`distance to the nearest wall` gives the closest edge in **any** direction. It
cannot tell "about to hit that" from "driving safely alongside it", so a bot
using it has to turn away whenever it is merely near a wall, which in a 54 metre
arena is most of the time.

`clear space ahead of me` gives the open floor in front of the nose, along the
way the hull points, measured from the front of the hull so it reads 0 on
contact. That is the one to test before driving forward.

Same bot, same 14 metre margin, 60 battles each: the directional sensor wins 73%
against the other one's 53%, takes 73 damage a battle against 127, and stays
alive 155 seconds against 83. Not because it is safer, but because it stops the
bot wasting the match turning away from walls it was never going to hit.

## The ladder

The five rivals are shown in the order they should be met, and each one is there
to teach one thing.

| Rival | What it teaches |
| --- | --- |
| **Lamppost** | Aiming. It never moves, so a miss is your gun, not their evasion. |
| **Coward** | Closing. It runs and plinks from range, so you have to go and get it. |
| **Pacer** | Leading. It moves in a straight line, the easiest thing in the game to shoot in front of. |
| **Orbit** | Tracking. It circles, so a gun aimed where it was misses where it is. |
| **Hunter** | Escaping. It closes and fires heavy at point blank. Be somewhere else. |

Beat one and the next unlocks. Everything in the arena counts, so beating three
at once climbs three rungs.

## Sending someone your bot

**Copy link** in the Scripts panel puts your whole script in a URL. No account,
no server, nothing to sign up for. It is compressed, so a typical script comes
out around 400 to 600 characters, and one too large to fit is refused rather
than silently truncated.

Whoever opens the link is asked whether to put your bot **in their arena**. It
goes into their battle list and never into their editor, so they can fight it
but they cannot read it. That is the same deal the built-in rivals get: you work
out what a bot does by watching it, not by opening it. Their own script is left
alone.

**Or paste it straight in.** There is a box in the battle list: paste a link
into it and the bot joins the arena on the spot, no reloading. It takes a whole
URL, just the `#bot=...` part, or the bare code, and it acts on the paste itself
so there is usually nothing to click. A link that is not a link, or one that
arrived damaged, says which.

You can keep up to five sent bots. Each one sits in the battle list and can be
put in or left on the bench.

Beating a challenger does not climb the ladder. That is for the roster.

## Watching, and practising alone

The **You** row in the battle list has a button that takes your own bot out.

**Sit yourself out** and the bots that are left fight each other. That is how you
run two bots somebody sent you against each other, with nobody of yours in the
way. While you are watching, the script panel stays empty and says so: the only
program this game ever renders is your own, so a sealed bot stays sealed even
when it is the only thing on screen.

**Leave yourself in with nobody else** and you get a practice run. One bot, an
empty arena, the full three minutes, and no opponents to interrupt. It is the
right way to watch how your movement actually behaves, whether the wall margin
is doing what you think, and where the bot spends its time.

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
