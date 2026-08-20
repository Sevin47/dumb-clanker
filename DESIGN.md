# Dumb Clanker — Design Document

> Brainstorm a strategy, program your bot, set it loose.

A browser-based programming game in the spirit of **Robocode**. You write Clank
Script to control a single bot. It scans with radar, aims a turret, and drives
around hunting the other bots. Knock them out before they knock out you.

---

## 1. Core Pillars

1. **The program is the only variable.** Every bot in the arena is mechanically
   identical. There is no build, no economy, no loadout. If your bot wins it is
   because your code was better, and if it loses that is a bug you can find.
2. **You are never at the controls.** Once the battle starts you are a
   spectator. The job of everything on screen is to show you what your script
   is actually doing.
3. **Three things turn independently.** Hull, turret and radar. This is where
   the depth lives: drive one way, shoot another, look a third.
4. **Readable opposition.** Every rival is written in the same blocks the player
   has, and any of them can be opened and copied. Losing should teach you
   something specific.

---

## 2. The Standard Bot

| | |
|---|---|
| **Hull** | 2.0 x 1.6m, 120kg, 8 m/s top speed, real momentum and a little slide |
| **Turret** | Turns at 2.6 rad/s, independently of the hull |
| **Radar** | Turns at 6.0 rad/s. A **12° beam** reaching 30m |
| **Health** | One pool of 140. No component damage — the bot just scorches and smokes |

The arena is a **54m square**, about 27 bot-widths across. Radar reaches 52m, so
it covers most of the field but not corner to corner. Start positions are
**randomised every battle**, so no script can be tuned against a known opening.

A field this size has to be crossable: bots move at 10 m/s and a battle runs 180
seconds. At the earlier 8 m/s over 120 seconds, two thirds of battles ran out the
clock while bots were still looking for each other.

### Why the radar is a beam and not a bubble
An all-round sensor would make radar a non-decision. A narrow beam means a
script must choose every moment between *sweeping* to find people and *locking*
to keep firing solutions fresh — and that choice is the first real strategy a
new player meets.

### The gun
Health plus **gun heat**: firing locks the gun until it cools. Heavier shots
hurt more, fly slower, and lock the gun for longer.

| Power | Damage | Speed | Gun locked for |
|---|---|---|---|
| 0.5 | 2 | 20 m/s | ~1.2s |
| 1.5 | 7 | 16 m/s | ~1.9s |
| 3.0 | 16 | 10 m/s | ~3.0s |

**The spread had to be wide.** Measured with a narrow one, bots hit with nearly
every shot and whoever fired hardest simply won — there was no decision. At 10
m/s against bots that move at 8, a power-3 round now genuinely misses anything
that is not asleep.

*Open question:* firing costs nothing but time, so a bot can spray at nothing
for free. Robocode charges energy for every shot and refunds it on a hit, which
makes accuracy self-funding. If bots end up spraying, that is the fix.

---

## 3. Clank Script

Scratch-shaped blocks in stacks headed by a "when…" hat.

### How it runs
- **`when the match starts`** is the standing plan. Put a `forever` in it.
- **Every other hat is an interrupt.** It takes over, runs to the end, then the
  standing plan resumes from exactly where it left off.

True Scratch runs every hat concurrently, which for a robot means several stacks
fighting over one set of controls — the most confusing thing that can happen to
someone who does not program. One plan plus interrupts keeps it to a sentence.

### Three channels
Motion, turret and radar are separate. A block only touches the channel it
names, so `sweep radar right` keeps sweeping while the hull drives and the gun
aims somewhere else entirely. This is what makes independent rotation usable
rather than merely present.

### One simplification worth stating
Conditions are **not** free-form nested expressions but a fixed
*sensor / comparison / value* triple: `if [distance to target] [is less than] [10]`.
That covers nearly everything a fighting robot decides and removes the fiddliest
part of a block editor.

### No block may both sense and act
This is the rule the vocabulary is built on. A block either reports something,
or moves something, or fires — never "look at X and do the right thing about
it". Judgement belongs to the player.

Earlier drafts broke it badly. `aim and fire` swung the turret onto the target,
waited for the gun to cool, checked alignment and shot: the entire combat loop
in a single drag. `keep radar on the target` gave away radar tracking, which is
the classic Robocode skill. Both are gone, along with `aim turret at the target`.

**Any number slot can be driven by a sensor instead of a fixed value.** That is
what makes the rule survivable — without it there is no way to express "turn the
turret by however far off it is", which is precisely why the do-everything
blocks existed. Three angle sensors are **signed**, negative meaning left, so
`turn turret right [turret turn needed]` swings the gun the correct way with no
arithmetic blocks anywhere in the language.

Aiming is now three blocks instead of one, and each is a decision that can be
got wrong:

```
turn radar right  [radar turn needed]      keep the beam on them
turn turret right [turret turn needed]     swing the gun on
if [how far my turret is off target] is less than [5]
  fire with power [1.2]                    your call, and only if the gun is cool
```

Crucially each turn block corrects **once**. A moving target needs re-aiming
every lap, which is exactly the work a Robocode player does by hand.

### Safety nets, because the player is not a programmer
- A `forever` loop yields one tick per lap. Without that, a loop of instant
  blocks would burn the whole step budget every frame.
- A per-tick block budget catches anything else runaway.
- `wait until` gives up after 8 seconds; every timed action carries a deadline.
- An empty `forever` is reported, not spun on.

---

## 4. The Battle

A square arena. You pick the field: up to five opponents, and the same rival may
be entered more than once. Last bot moving wins; on a timeout the healthiest
does.

### Measured behaviour of the roster
Round-robin, damage dealt versus damage taken:

| Rival | Strategy | Damage ratio |
|---|---|---|
| **Orbit** | Circles its target | **2.42** |
| **Hunter** | Closes and fires heavy | 1.39 |
| **Lamppost** | Never moves, perfect aim | 1.25 |
| **Pacer** | Drives back and forth | 0.66 |
| **Coward** | Retreats and plinks | 0.36 |

That ordering is the lesson the game teaches, and it came out of the physics
rather than being designed in: **circling beats charging beats standing still,
and moving straight towards or away from someone is worse than not moving at
all**, because radial movement does nothing to spoil an enemy's aim.

---

## 5. Watching the script run

A block language hides its own failures. A bot that drives in circles looks the
same whether the script is doing what you asked or silently skipping half of it,
and no amount of watching the arena will tell you which.

So the arena carries a debug console down its left side:

- **The script, as written**, in the same blocks — not a textual log of it.
- **The executing block outlined in white**, moving as it runs.
- **Per-block counters**: how many times each block fired, and what share of the
  battle it held. A block that costs 40% of the match is the first place to look
  when a bot feels sluggish.
- **`never` markers.** Any block that has not run is dimmed and labelled, and a
  warning appears if a whole stack has stayed cold. This is the single most
  valuable readout: an event hat that never fires, or an `if` whose test is never
  true, is the most common way a script quietly does nothing.
- **Transport controls**: pause, single-step, and 0.5× to 4× speed. Slow motion
  is how you see whether a turret is actually tracking; fast forward is how you
  get to the part of the battle you care about.

The script markup is built once per battle and only classes and a few numbers
change per frame — re-rendering a script at 60fps would cost more than the game.

## 6. Persistence

Scripts autosave to local storage on every edit, and the workshop keeps a named
library beside the editor. There is no server — the game is a static page — so
local storage is the only option, with two consequences worth designing around:

- **It is per-browser and easily wiped.** Export writes a script to a file and
  Import reads one back, so work can outlive a cleared cache and be shared.
- **Saved data outlives the language.** Blocks have been renamed and removed
  outright more than once in this project's life. Every load is therefore
  sanitised, not trusted: unknown blocks are dropped, hats that are no longer
  hats are dropped, missing arguments are filled from defaults, and ids are
  regenerated. A save from an older version opens with the parts that still make
  sense rather than refusing to open at all.

## 7. Presentation

- **Pixel art**: the 3D scene renders to a 480x270 buffer and is upscaled with
  no smoothing.
- **The interface is not pixel art.** The HUD is drawn straight onto the
  full-resolution canvas so it can use a readable sans at a real size. Retro
  styling is for the arena; anything the player has to *read* is optimised for
  reading.
- **Top-down, orthographic, fixed.** The whole field is on screen at all times,
  exactly like Robocode. The camera fits the arena to the area *clear of the HUD
  bar and the field roster*, and nudges it only as far as it actually overlaps
  them — fitting to the raw viewport instead tucks the top and right walls under
  the readouts. Nobody is driving, so the job of the shot is
  to show the geometry of the fight rather than to look cinematic. An
  orthographic camera means a bot in the corner is drawn the same as one in the
  middle, which matters when you are reading positions off the screen.
- **Every bot's radar beam is drawn on the floor**, in that bot's colour, clipped
  to the arena. Yours is brightest. Being able to see what the *opposition* can
  see is the difference between "it shot me" and "it swept across me, so it
  knew where I was".

---

## 8. Technology

**Web / TypeScript.** `planck.js` for 2D physics, `three.js` for presentation,
and a small hand-written interpreter for Clank Script. Bullets are integrated by
hand rather than as physics bodies — they only need a point-in-hull test, and
sub-stepping stops fast rounds tunnelling through a bot.

---

## 9. Notes from implementation

- **A stationary bot must not be competitive, and nearly was.** Lamppost — a bot
  whose entire program is "sweep and shoot" — tied for first until the gun
  numbers were spread out. Any design where the do-nothing bot wins is broken,
  and the fix was making heavy shots slow enough to dodge.
- **Radial movement is not evasion.** Pacer moves constantly and has the second
  worst damage ratio in the roster. Driving at or away from someone keeps you on
  the same bearing, which is exactly where their gun already points.
- **A bigger field changed who wins.** Lamppost, the bot that never moves, fell
  from a 1.25 damage ratio to 0.61 the moment the arena grew: its slow heavy
  shots simply cannot reach a moving target across 50m. Space punishes standing
  still far more effectively than any rule could.
- **Recall is a debugging tool, not a panic button.** It teleports the player's
  bot clear and restarts its script, which is what you want when a script
  deadlocks. It costs a hot gun and every radar contact, so it cannot be used to
  dodge a shot or reposition for free.
- **Convenience blocks quietly removed the game.** The measured cost of taking
  them out: aiming went from one block to three, and every rival script grew by
  about half. The measured *benefit*: continuous movement now costs you aim,
  because a bot that is strafing is not re-aiming. Orbit's damage ratio fell
  from 2.42 to 0.85 the moment auto-tracking was withdrawn — circling stopped
  being free, and became a trade against gun time.
- **A mirrored radar beam looked exactly like a cheating bot.** The wedge was
  rotated in its own plane and then tipped flat, and tipping it flat flips the
  in-plane angle — so the beam was drawn at `-radar` while the radar actually
  looked at `+radar`. Bots appeared to fire at targets their radar had never
  touched. The logic had been right the whole time. Anything that rotates now
  steers on its parent group about Y, the same as the hull and turret.
- **The block language beat the hand-written AI.** An earlier version of this
  game shipped a bespoke opponent AI. It is gone: rivals now run authored Clank
  Script, and they fight better than the hand-written code did. If the language
  could not express a competent robot, that would be a design failure worth
  discovering.
