import { BLOCK_BY_OP } from './blocks';
import { makeNode, starterProgram, uid, type Node, type Program, type Stack } from './program';

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
}

const emptyFile = (): SaveFile => ({
  version: 1,
  currentName: 'My bot',
  current: starterProgram(),
  library: [],
  field: ['lamppost', 'hunter'],
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
      field: Array.isArray(raw.field) ? raw.field.filter((f) => typeof f === 'string') : ['lamppost', 'hunter'],
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
