import { BLOCK_BY_OP } from './blocks';
import { LADDER, makeNode, starterProgram, uid, type Node, type Program, type Stack } from './program';

/**
 * Saving scripts.
 *
 * Everything lives in localStorage: the game is a static page with no server,
 * so there is nowhere else to put it. That also means a cleared browser wipes
 * the lot, which is why export-to-file exists alongside it.
 *
 * Every load is sanitised rather than trusted. The block vocabulary has changed
 * several times already — blocks have been renamed and removed outright — so a
 * script saved against an older version must degrade quietly instead of
 * crashing the editor. Unknown blocks are dropped, missing arguments are filled
 * from defaults, and ids are regenerated so nothing can collide.
 */

const KEY = 'dumbclanker.save.v1';

export interface SavedScript {
  id: string;
  name: string;
  savedAt: number;
  program: Program;
}

export interface SaveFile {
  version: 1;
  currentName: string;
  current: Program;
  library: SavedScript[];
  field: string[];
  /**
   * Rivals the player has beaten, which is what unlocks the next rung of the
   * ladder. A save from before this existed has no list, and gets all of them:
   * a returning player should not find four opponents suddenly taken away.
   */
  beaten: string[];
  /**
   * Bots people have sent by link. They live here and nowhere else: they never
   * touch the editor, so their scripts cannot be read, exactly like a rival's.
   */
  challengers: Challenger[];
  /**
   * Saved scripts of the player's own currently in the arena, by library id.
   * The same one may appear twice, the same as a rival, so a script can be set
   * against a copy of itself.
   */
  sparring: string[];
  /**
   * Whether the player's own bot is in the arena. Off means watching, which is
   * how two challengers fight each other.
   */
  joinIn: boolean;
}

export interface Challenger {
  id: string;
  name: string;
  program: Program;
  /** In the arena for the next battle. */
  inField: boolean;
}

/** Five is the arena cap, so more than that could never all fight anyway. */
export const MAX_CHALLENGERS = 5;

const emptyFile = (): SaveFile => ({
  version: 1,
  currentName: 'My bot',
  current: starterProgram(),
  library: [],
  beaten: [],
  challengers: [],
  sparring: [],
  joinIn: true,
  field: ['lamppost'],
});

// ---------------------------------------------------------------- sanitising

function cleanNode(raw: unknown): Node | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Node>;
  const def = typeof r.op === 'string' ? BLOCK_BY_OP[r.op] : undefined;
  // A block that no longer exists in the language is dropped, not guessed at.
  if (!def || def.hat) return null;

  const node = makeNode(r.op as string);
  for (const key of Object.keys(node.args)) {
    const v = (r.args as Record<string, unknown> | undefined)?.[key];
    if (typeof v === 'number' || typeof v === 'string') node.args[key] = v;
  }
  if (node.body) node.body = cleanList((r as Node).body);
  if (node.body2) node.body2 = cleanList((r as Node).body2);
  return node;
}

const cleanList = (raw: unknown): Node[] =>
  Array.isArray(raw) ? (raw.map(cleanNode).filter(Boolean) as Node[]) : [];

function cleanStack(raw: unknown): Stack | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { hat?: Partial<Node>; body?: unknown };
  const op = r.hat?.op;
  const def = typeof op === 'string' ? BLOCK_BY_OP[op] : undefined;
  if (!def?.hat) return null;

  const hat = makeNode(op as string);
  for (const key of Object.keys(hat.args)) {
    const v = (r.hat?.args as Record<string, unknown> | undefined)?.[key];
    if (typeof v === 'number' || typeof v === 'string') hat.args[key] = v;
  }
  return { id: uid('s'), hat, body: cleanList(r.body) };
}

export function cleanProgram(raw: unknown): Program {
  const stacks = Array.isArray((raw as Program)?.stacks)
    ? ((raw as Program).stacks.map(cleanStack).filter(Boolean) as Stack[])
    : [];
  return { stacks };
}

// ---------------------------------------------------------------- the file

function readOne(raw: unknown): Challenger | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as { id?: unknown; name?: unknown; program?: unknown; inField?: unknown };
  const program = cleanProgram(c.program);
  if (!program.stacks.length) return null;
  return {
    id: typeof c.id === 'string' ? c.id : uid('chal'),
    name: typeof c.name === 'string' ? c.name.slice(0, 40) : 'A challenger',
    program,
    inField: c.inField !== false,
  };
}

/** Reads the list, and carries over a save from when there was only one slot. */
function readChallengers(raw: Partial<SaveFile> & { challenger?: unknown }): Challenger[] {
  if (Array.isArray(raw.challengers)) {
    return raw.challengers.map(readOne).filter((c): c is Challenger => !!c).slice(0, MAX_CHALLENGERS);
  }
  const single = readOne(raw.challenger);
  return single ? [single] : [];
}

export function loadFile(): SaveFile {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return emptyFile();
    const raw = JSON.parse(text) as Partial<SaveFile>;
    const current = cleanProgram(raw.current);
    return {
      version: 1,
      currentName: typeof raw.currentName === 'string' ? raw.currentName : 'My bot',
      current: current.stacks.length ? current : starterProgram(),
      library: Array.isArray(raw.library)
        ? raw.library
            .map((s) => ({
              id: typeof s?.id === 'string' ? s.id : uid('save'),
              name: typeof s?.name === 'string' ? s.name : 'Untitled',
              savedAt: typeof s?.savedAt === 'number' ? s.savedAt : 0,
              program: cleanProgram(s?.program),
            }))
            .filter((s) => s.program.stacks.length)
        : [],
      field: Array.isArray(raw.field) ? raw.field.filter((f) => typeof f === 'string') : ['lamppost'],
      // No list at all means a save from before the ladder existed. Treat that
      // player as a veteran rather than locking away what they already had.
      beaten: Array.isArray(raw.beaten)
        ? raw.beaten.filter((b) => typeof b === 'string')
        : [...LADDER],
      challengers: readChallengers(raw),
      sparring: Array.isArray(raw.sparring) ? raw.sparring.filter((x) => typeof x === 'string') : [],
      joinIn: raw.joinIn !== false,
    };
  } catch {
    // Corrupt or unreadable storage should never stop the game opening.
    return emptyFile();
  }
}

export function saveFile(file: SaveFile): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(file));
    return true;
  } catch {
    // Private browsing and full quotas both throw here.
    return false;
  }
}

// ---------------------------------------------------------------- files

export function exportScript(name: string, program: Program) {
  const blob = new Blob([JSON.stringify({ version: 1, name, program }, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9 _-]/gi, '').trim() || 'clank-script'}.clank.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importScript(file: File): Promise<{ name: string; program: Program } | null> {
  try {
    const raw = JSON.parse(await file.text()) as { name?: unknown; program?: unknown };
    const program = cleanProgram(raw.program);
    if (!program.stacks.length) return null;
    return { name: typeof raw.name === 'string' ? raw.name : file.name.replace(/\..*$/, ''), program };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ challenge links

/**
 * A script packed into a URL, so one player can send another their bot with no
 * server involved anywhere.
 *
 * Deflate then base64url. `CompressionStream` is built into the browser, which
 * keeps this dependency-free and matches how the rest of the game is built.
 * Scripts are mostly repeated key names, so they compress hard: a 40 block bot
 * lands comfortably inside what a URL can carry.
 */

/** Browsers vary, but every one of them is unhappy well before this. */
const MAX_LINK = 8000;

const toBase64Url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string): Uint8Array => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

async function squeeze(bytes: Uint8Array, mode: 'deflate-raw'): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream(mode));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unsqueeze(bytes: Uint8Array, mode: 'deflate-raw'): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(mode));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Returns a shareable URL, or null if this script is too big to fit in one. */
export async function challengeLink(name: string, program: Program): Promise<string | null> {
  try {
    const json = JSON.stringify({ n: name, p: program });
    const packed = await squeeze(new TextEncoder().encode(json), 'deflate-raw');
    const url = `${location.origin}${location.pathname}#bot=${toBase64Url(packed)}`;
    return url.length > MAX_LINK ? null : url;
  } catch {
    return null;
  }
}

/** Why a pasted link could not be used, in words a player can act on. */
export type ChallengeError = 'empty' | 'not-a-link' | 'unreadable';

export interface DecodedChallenge {
  name: string;
  program: Program;
}

/**
 * Pull a bot out of anything that might contain one: a whole URL, just the
 * `#bot=...` part, or the bare code on its own. People paste all three.
 *
 * Runs through the same sanitiser as an imported file, because a link is a
 * stranger's data and gets no more trust than a stranger's file.
 */
export async function decodeChallenge(
  text: string,
): Promise<{ ok: DecodedChallenge } | { error: ChallengeError }> {
  const trimmed = text.trim();
  if (!trimmed) return { error: 'empty' };

  const found = /[#&?]bot=([A-Za-z0-9_-]+)/.exec(trimmed);
  // A bare code has no bot= in front of it, so accept that too, but only if it
  // looks like one rather than like a sentence.
  const code = found ? found[1] : /^[A-Za-z0-9_-]{24,}$/.test(trimmed) ? trimmed : null;
  if (!code) return { error: 'not-a-link' };

  try {
    const json = new TextDecoder().decode(await unsqueeze(fromBase64Url(code), 'deflate-raw'));
    const raw = JSON.parse(json) as { n?: unknown; p?: unknown };
    const program = cleanProgram(raw.p);
    if (!program.stacks.length) return { error: 'unreadable' };
    return { ok: { name: typeof raw.n === 'string' ? raw.n.slice(0, 40) : 'A challenger', program } };
  } catch {
    return { error: 'unreadable' };
  }
}

/** The same thing, read out of the address bar when the game is opened by link. */
export async function challengeFromUrl(): Promise<DecodedChallenge | null> {
  if (!location.hash.includes('bot=')) return null;
  const result = await decodeChallenge(location.hash);
  return 'ok' in result ? result.ok : null;
}

/** Take the script out of the address bar once it has been dealt with. */
export function clearChallengeFromUrl() {
  history.replaceState(null, '', location.pathname + location.search);
}


// ------------------------------------------------------------ view settings

/**
 * Whether the script panel shows during a battle. A view preference rather
 * than game data, so it gets its own key and never rides along with a script.
 */
const PANEL_KEY = 'dumbclanker.panel.v1';

export function loadPanelOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

export function savePanelOpen(open: boolean) {
  try {
    localStorage.setItem(PANEL_KEY, open ? 'shown' : 'hidden');
  } catch {
    // A browser that will not store a preference still has to run the game.
  }
}
