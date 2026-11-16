// lib/drivers/git.js
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, realpathSync, lstatSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeAllowed } from '../autonomy.js';

// The authority a write is evaluated under when the caller declares none. It is NOT
// "unrestricted": `observe` is the bottom of the ladder and writes nothing, so an
// undeclared write is refused. See write() below for why this is the only safe default.
const FAIL_CLOSED_AUTHORITY = 'observe';

// Resolve the deepest existing component with lstat, not existsSync: the latter
// follows links and treats a dangling final symlink as an ordinary missing file.
function nearestExisting(path) {
  let ancestor = path;
  for (;;) {
    try {
      lstatSync(ancestor);
      return ancestor;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}

function canonicalPath(path) {
  const ancestor = nearestExisting(path);
  return resolve(realpathSync(ancestor), relative(ancestor, path));
}

function isOutside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== candidate;
}

function confined(root, p, { directory = false } = {}) {
  if (typeof p !== 'string' || (!directory && p.length === 0) || p.includes('\0')) {
    throw new Error('path outside garden root: empty or invalid path');
  }
  if (existsSync(root) && (lstatSync(root).isSymbolicLink() || !statSync(root).isDirectory())) {
    throw new Error('garden root must be a real directory, not a file or symlink');
  }
  const absolute = directory && p === '' ? root : resolve(root, p);
  if (isOutside(root, absolute)) throw new Error(`path outside garden root: ${p}`);

  // Keep lexical and canonical boundaries separate. An operator may reach a real
  // root through a symlinked PARENT; the root's own final component must be real.
  const canonicalRoot = canonicalPath(root);
  let finalStat = null;
  try { finalStat = lstatSync(absolute); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (finalStat?.isSymbolicLink() && !existsSync(absolute)) {
    throw new Error(`path outside garden root: dangling final symlink ${p}`);
  }
  const real = canonicalPath(absolute);
  if (isOutside(canonicalRoot, real)) throw new Error(`path outside garden root: ${p}`);
  if (finalStat && statSync(absolute).isDirectory() !== directory) {
    throw new Error(`path outside garden root: ${p} has the wrong path type`);
  }
  return absolute;
}

export class GitDriver {
  // `authority` is an optional standing declaration for callers that resolve the
  // operator's grant once (from `.overlay/` via loadAutonomy) rather than per write.
  // GARDEN_AUTHORITY is the same declaration from the environment. Both are explicit
  // acts; neither is a default.
  constructor({ root, sync = true, authority } = {}) {
    this.root = root;
    this._sync = sync;
    const env = process.env.GARDEN_AUTHORITY;
    // An empty string is not a declaration — it is an unset variable that happens to
    // be exported, and treating it as one would be a silent bypass.
    this._authority = authority !== undefined ? authority : (env ? env : undefined);
    // Canonicalize without creating anything. Resolve the nearest existing
    // ancestor so a fresh garden can be created lazily by its first valid write.
    this.root = resolve(root);
  }
  _rootReal() {
    return canonicalPath(this.root);
  }

  read(p) {
    const f = confined(this.root, p);
    return existsSync(f) ? readFileSync(f, 'utf8') : null;
  }

  // Declare which region a path belongs to (AUTONOMY.md §Two enforcement layers).
  // Git history is reversible and every file is agent-writable, so this driver
  // owns no human region — `state/decisions.md` is a proposal surface, the rest
  // is agent-owned. The act-gate does the real work for git; a live backend
  // (e.g. Notion) overrides this to mark human-set fields human-owned.
  regionOf(p) { return p === 'state/decisions.md' ? 'proposal' : 'agent'; }

  // The driver write-policy (AUTONOMY.md §Two enforcement layers): the backend refuses
  // a write the granted authority may not make, INDEPENDENTLY of the loop. That is the
  // whole point of a second layer — "a jailbroken or confused loop still cannot mutate
  // protected state".
  //
  // This used to be guarded by `if (authority !== undefined && …)`, which made the
  // second layer OPT-IN PER CALL: a caller that simply omitted `authority` bypassed it
  // entirely — and a jailbroken loop is precisely a caller that would omit it. The
  // shipped CLI omitted it on every write, so the enforcement layer the contract leans
  // on was not running on the artefact's own code path. Worse, the permissiveness was
  // inherited: a subclass declaring a HUMAN-owned region (the Notion case the contract
  // is written for) refused the write with an authority and performed it without one.
  //
  // So: an absent authority is resolved, never skipped, and it resolves DOWN. The
  // resolution order is explicit-per-call → standing declaration (constructor or
  // GARDEN_AUTHORITY) → `observe`, which writes nothing.
  write(p, content, { authority } = {}) {
    const region = this.regionOf(p);
    const declared = authority !== undefined ? authority : this._authority;
    const effective = declared !== undefined ? declared : FAIL_CLOSED_AUTHORITY;
    if (!writeAllowed(effective, region)) {
      throw new Error(
        `write refused: authority '${effective}' may not write the ${region} region (${p})` +
        (declared === undefined
          ? '\n  No authority was declared for this write, and an absent authority is not a permission.' +
            '\n  Declare one: pass { authority } to write(), or construct the driver with' +
            '\n  { authority }, or set GARDEN_AUTHORITY. Resolve it from the operator overlay' +
            '\n  with loadAutonomy(root).authorityFor(capability) — which fails closed to R0.'
          : ''),
      );
    }
    const f = confined(this.root, p);
    if (existsSync(this.root)
        && (lstatSync(this.root).isSymbolicLink() || !statSync(this.root).isDirectory())) {
      throw new Error('garden root must be a real directory, not a file or symlink');
    }
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, content);
  }

  list(prefix = '') {
    const base = confined(this.root, prefix, { directory: true });
    if (!existsSync(base)) return [];
    const out = [];
    const rootReal = this._rootReal();
    const logicalBase = relative(this.root, base);
    const walk = (dir) => {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const st = statSync(full);
        const real = realpathSync(full);
        const rel = relative(rootReal, real);
        if (rel === '..' || rel.startsWith(`..${sep}`)) {
          throw new Error(`path outside garden root: ${relative(this.root, full)}`);
        }
        if (st.isDirectory()) walk(full);
        else out.push(join(logicalBase, relative(base, full)).split('\\').join('/'));
      }
    };
    walk(base);
    return out;
  }

  index(kind) {
    if (kind === 'board') return this._parseBoard();
    if (kind === 'handoffs') return this._parseHandoffIndex();
    throw new Error(`unknown index kind: ${kind}`);
  }

  _parseBoard() {
    const text = this.read('state/threads.md') || '';
    const out = [];
    let lane = null;
    for (const raw of text.split('\n')) {
      const h = raw.match(/^##\s+(.+?)\s*$/);
      if (h) { lane = h[1]; continue; }
      // - [ ] (P1) #id title — desc     (priority + desc optional)
      const m = raw.match(/^- \[( |x)\]\s*(?:\(P([1-4])\)\s*)?#(\S+)\s+(.+?)(?:\s+—\s+(.+))?\s*$/);
      if (m) out.push({
        lane, status: m[1] === 'x' ? 'done' : 'open',
        priority: m[2] ? Number(m[2]) : null,
        id: m[3], title: m[4], desc: m[5] || null,
      });
    }
    return out;
  }

  _parseHandoffIndex() {
    const text = this.read('handoffs/index.md') || '';
    const out = [];
    for (const raw of text.split('\n')) {
      const m = raw.match(/^-\s+(\d{4}-\d{2}-\d{2})\s+·\s+(\S+)\s+·\s+(.+?)\s*$/);
      if (m) out.push({ date: m[1], topic: m[2], summary: m[3] });
    }
    return out;
  }

  resolve(ref) {
    if (ref.startsWith('#')) {
      const id = ref.slice(1);
      const item = this._parseBoard().find(i => i.id === id);
      if (item) return { kind: 'board-item', id, ...item };
    }
    return null;
  }

  sync() {
    if (!this._sync) return { synced: false, reason: 'disabled' };
    const git = (...a) => execFileSync('git', ['-C', this.root, ...a], { stdio: 'pipe' });
    try {
      git('rev-parse', '--is-inside-work-tree');
    } catch { return { synced: false, committed: false, reason: 'not-a-repo' }; }

    // 1. Commit locally first — never lose local work due to a failed pull/push.
    let committed = false;
    try {
      git('add', '-A');
      git('commit', '-q', '-m', 'garden: sync');
      committed = true;
    } catch {
      // "nothing to commit" exits non-zero — that is fine, committed stays false
    }

    // 2. Best-effort pull then push; failures are non-fatal.
    let synced = false;
    let reason;
    try {
      git('pull', '--ff-only', '--quiet');
      git('push', '--quiet');
      synced = true;
    } catch (e) {
      reason = String(e.message || e).split('\n')[0];
    }

    return { committed, synced, ...(reason !== undefined ? { reason } : {}) };
  }
}
