import type { Match, MatchEvent } from './match';

/**
 * Sound, synthesised.
 *
 * No asset files anywhere. Everything here is a couple of oscillators and an
 * envelope, which keeps the bundle tiny, keeps the static host simple, and
 * suits a game whose art is deliberately cheap.
 *
 * The one that earns its place is the heat lockout. Asking a hot gun to fire
 * does nothing at all, and until now there was no way to perceive that: the
 * script looks right, the block lights up, and no bullet comes out. A click
 * tells you.
 */

/** Browsers refuse to start audio until the player has interacted with the page. */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let lastSeq = 0;

export function audioReady(): boolean {
  return !!ctx && ctx.state === 'running';
}

export function toggleAudio(on: boolean) {
  enabled = on;
  if (master) master.gain.value = on ? 0.35 : 0;
}

export function audioEnabled(): boolean {
  return enabled;
}

/** Call from a click. Anything earlier is refused by the browser. */
export function startAudio() {
  if (ctx) {
    void ctx.resume();
    return;
  }
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.35 : 0;
    master.connect(ctx.destination);
  } catch {
    // No audio is a perfectly survivable state. Never let it stop the game.
    ctx = null;
  }
}

/** One shaped tone. Everything in here is built out of these. */
function tone(opts: {
  type: OscillatorType;
  from: number;
  to: number;
  seconds: number;
  gain: number;
  delay?: number;
}) {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + opts.seconds);
  // A quick attack and an exponential tail: percussive, and no clicks at either end.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.seconds);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + opts.seconds + 0.02);
}

/** Filtered noise, for impacts. */
function thump(seconds: number, gain: number, cutoff: number) {
  if (!ctx || !master) return;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Decaying white noise. Cheaper than it looks and it reads as an impact.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(master);
  src.start();
}

function play(e: MatchEvent) {
  // Anything not involving the player is quieter, or a six bot melee is a mess.
  const near = e.isPlayer ? 1 : 0.4;
  switch (e.kind) {
    case 'fire': {
      // Heavier rounds are lower and longer, the same way they are slower.
      const base = 320 - e.power * 60;
      tone({ type: 'square', from: base, to: base * 0.35, seconds: 0.1 + e.power * 0.04, gain: 0.16 * near });
      thump(0.09, 0.1 * near, 900);
      break;
    }
    case 'hit':
      tone({ type: 'triangle', from: 220, to: 90, seconds: 0.12, gain: 0.18 * near });
      thump(0.13, 0.16 * near, 1600);
      break;
    case 'wall':
      thump(0.18, 0.2 * near, 500);
      break;
    case 'ram':
      thump(0.22, 0.22 * near, 700);
      tone({ type: 'sawtooth', from: 120, to: 60, seconds: 0.16, gain: 0.1 * near });
      break;
    case 'death':
      tone({ type: 'sawtooth', from: 260, to: 40, seconds: 0.7, gain: 0.22 * near });
      thump(0.5, 0.24 * near, 800);
      break;
    case 'heatblock':
      // Deliberately small and dry. It is a failure, not an event.
      if (!e.isPlayer) return;
      tone({ type: 'square', from: 1500, to: 1400, seconds: 0.02, gain: 0.05 });
      break;
  }
}

/**
 * Play whatever has happened since the last call. Driven from the frame loop
 * rather than from Match, so a headless bench run makes no sound and pays no
 * cost for it.
 */
export function playMatchAudio(m: Match) {
  if (!ctx || !enabled || ctx.state !== 'running') {
    // Still advance the marker, or unmuting replays the whole battle at once.
    lastSeq = m.events.length ? m.events[m.events.length - 1].seq : lastSeq;
    return;
  }
  for (const e of m.events) {
    if (e.seq <= lastSeq) continue;
    lastSeq = e.seq;
    play(e);
  }
}

/** A new battle starts the numbering again. */
export function resetAudio() {
  lastSeq = 0;
}
