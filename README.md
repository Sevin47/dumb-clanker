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

The arena is a 36m square, shown top-down in full at all times. **Every bot's
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
  `if [distance to target] [is less than] [10]`.
- **No block both senses and acts.** Nothing aims for you.

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

## The battle

Pick who is in the arena with you and how many — up to five opponents, and you
can add the same one more than once. Every rival is written in the same blocks
you have, and **you can copy any of their scripts** from the dropdown above the
canvas to see how it works.

| Rival | What it does |
| --- | --- |
| **Lamppost** | Never moves. Perfect aim, and an easy target. |
| **Pacer** | Drives back and forth. Learns that moving *towards* people does not help. |
| **Hunter** | Locks radar, closes, fires heavy at point blank. |
| **Orbit** | Circles whatever it finds while tracking with radar and gun. |
| **Coward** | Keeps its distance and plinks with light, fast rounds. |

## Controls

There are none during a battle — the bots are running their own programs. On the
result screen, `R` runs it again and `B` goes back to the workshop.

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
| `src/editor.ts` | Block editor: palette, drop gaps, drag and drop |
| `src/bot.ts` | The bot: hull, turret, radar, health, gun heat |
| `src/match.ts` | Arena, bullets, radar sweeps, collisions, standings |
| `src/render.ts` | 3D scene, camera framing, compositing |
| `src/hud.ts` | HUD, field roster, result standings |
| `src/workshop.ts` | Workshop screen: editor plus battle setup |
