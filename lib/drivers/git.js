// lib/drivers/git.js
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, realpathSync, lstatSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeAllowed, rankOf } from '../autonomy.js';

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

function isGitMetadata(path) {
  return path.split(/[\\/]+/).includes('.git');
}

function inside(candidate, parent) {
  return candidate === parent || !isOutside(parent, candidate);
}

function gitEnvironment() {
  // The operator owns Git metadata and the process's launch environment. Do not
  // let an agent-written document become configuration through inherited env.
  // Clear env config, global/system includes, hooks, pager/editor execution, and
  // repository redirects for this bounded operation.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'GIT_CONFIG' || key === 'GIT_CONFIG_PARAMETERS'
        || key === 'GIT_CONFIG_COUNT' || key.startsWith('GIT_CONFIG_KEY_')
        || key.startsWith('GIT_CONFIG_VALUE_') || key === 'GIT_DIR'
        || key === 'GIT_WORK_TREE' || key === 'GIT_COMMON_DIR'
        || key === 'GIT_INDEX_FILE' || key === 'GIT_OBJECT_DIRECTORY'
        || key === 'GIT_ALTERNATE_OBJECT_DIRECTORIES' || key === 'GIT_NAMESPACE'
        || key === 'GIT_CEILING_DIRECTORIES' || key === 'GIT_DISCOVERY_ACROSS_FILESYSTEM'
        || key === 'GIT_GLOB_PATHSPECS' || key === 'GIT_NOGLOB_PATHSPECS'
        || key === 'GIT_LITERAL_PATHSPECS' || key === 'GIT_ICASE_PATHSPECS'
        || key === 'GIT_ATTR_SOURCE' || key === 'GIT_PROTOCOL'
        || key === 'GIT_SSH' || key === 'GIT_SSH_COMMAND'
        || key === 'GIT_PROXY_COMMAND' || key === 'GIT_EXEC_PATH'
        || key === 'GIT_PAGER' || key === 'PAGER' || key === 'EDITOR'
        || key === 'GIT_EDITOR' || key === 'GIT_SEQUENCE_EDITOR') {
      delete env[key];
    }
  }
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', PAGER: 'cat',
    GIT_EDITOR: ':', GIT_SEQUENCE_EDITOR: ':',
  });
  // Preserve only the operator's global commit identity, not executable global
  // configuration, transport commands, or hooks. Includes are enabled solely for
  // this identity query; the returned name/email are re-injected using Git's
  // standard environment-config mechanism, not a custom file or global config.
  const identityEnv = { ...env };
  delete identityEnv.GIT_CONFIG_GLOBAL;
  let identity = '';
  try {
    identity = execFileSync('git', ['config', '--global', '--includes', '--null',
      '--get-regexp', '^user[.](name|email)$'], {
      encoding: 'utf8', env: identityEnv,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  const pairs = [];
  for (const entry of identity.split('\0').filter(Boolean)) {
    const split = entry.indexOf('\n');
    if (split > 0) pairs.push([entry.slice(0, split), entry.slice(split + 1)]);
  }
  env.GIT_CONFIG_COUNT = String(pairs.length);
  pairs.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}

function actualGitDir(canonicalRoot) {
  const marker = join(canonicalRoot, '.git');
  try {
    const stat = lstatSync(marker);
    // The supported repository layout is deliberately small: a real .git
    // directory with no common-dir redirection. Symlinked markers, worktree
    // pointers, and separate/shared metadata must not degrade into "no repo"
    // and thereby make their active configuration agent-writable.
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('non-conventional Git layout: .git must be a real directory');
    }
    const real = realpathSync(marker);
    if (real !== marker || existsSync(join(marker, 'commondir'))) {
      throw new Error('non-conventional Git layout: shared or redirected Git metadata is unsupported');
    }
    return real;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function confined(root, p, { directory = false } = {}) {
  if (typeof p !== 'string' || (!directory && p.length === 0) || p.includes('\0')) {
    throw new Error('path outside garden root: empty or invalid path');
  }
  if (isGitMetadata(p)) throw new Error('Git metadata is not agent-accessible');
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
  const gitDir = actualGitDir(canonicalRoot);
  if (gitDir && inside(real, gitDir)) {
    throw new Error(`Git metadata is not agent-accessible: ${p}`);
  }
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
  // Git metadata is excluded separately: it is operator-owned, never an agent
  // document, and cannot become executable configuration for sync.
  // Git history is reversible and every remaining document is agent-writable, so
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
    const visited = new Set();
    const gitDir = actualGitDir(rootReal);
    const walk = (dir) => {
      if (!existsSync(dir)) return;
      const realDir = realpathSync(dir);
      if (gitDir && inside(realDir, gitDir)) {
        throw new Error(`Git metadata is not agent-accessible: ${relative(this.root, dir)}`);
      }
      // A real directory may appear through several safe logical aliases. Stop
      // only cycles in this recursion chain, not every later alias globally.
      if (visited.has(realDir)) return;
      visited.add(realDir);
      try {
        for (const name of readdirSync(dir)) {
          if (name === '.git') continue;
          const full = join(dir, name);
          const st = statSync(full);
          const real = realpathSync(full);
          if (isOutside(rootReal, real)) {
            throw new Error(`path outside garden root: ${relative(this.root, full)}`);
          }
          if (gitDir && inside(real, gitDir)) {
            throw new Error(`Git metadata is not agent-accessible: ${relative(this.root, full)}`);
          }
          if (st.isDirectory()) walk(full);
          else out.push(join(logicalBase, relative(base, full)).split('\\').join('/'));
        }
      } finally {
        visited.delete(realDir);
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

  sync({ authority } = {}) {
    if (!this._sync) return { synced: false, reason: 'disabled' };
    const effective = authority !== undefined ? authority : (this._authority ?? FAIL_CLOSED_AUTHORITY);
    if (rankOf(effective) < rankOf('act:contained')) {
      throw new Error('sync requires act:contained authority or higher; commits and pushes are not read-only');
    }
    const root = this._rootReal();
    // Validate the supported layout before invoking Git: a commondir file can
    // redirect configuration and hooks away from the per-worktree directory.
    actualGitDir(root);
    const env = gitEnvironment();
    const git = (...a) => execFileSync('git', ['-C', root, ...a], {
      stdio: 'pipe', encoding: 'utf8', env,
    });
    let top;
    let gitDir;
    try {
      top = git('rev-parse', '--show-toplevel').trim();
      gitDir = git('rev-parse', '--absolute-git-dir').trim();
    } catch { return { synced: false, committed: false, reason: 'not-a-repo' }; }
    if (canonicalPath(top) !== root) {
      throw new Error('sync refused: repository root does not match garden root');
    }
    const metadataReal = realpathSync(gitDir);
    const conventional = lstatSync(join(root, '.git')).isDirectory()
      && realpathSync(join(root, '.git')) === metadataReal;
    if (!conventional || canonicalPath(metadataReal) !== metadataReal) {
      throw new Error('sync refused: Git metadata must be the canonical <garden>/.git directory');
    }

    // 1. Commit locally first — never lose local work due to a failed pull/push.
    // Staging and commit errors are not equivalent to an empty diff. A failed
    // add/commit must be visible and must never be followed by pushing stale HEAD.
    try {
      git('add', '-A', '--', '.');
    } catch (error) {
      throw new Error(`sync add failed: ${error.message}`);
    }
    let committed = false;
    let hasStagedChanges = false;
    try {
      git('diff', '--cached', '--quiet', '--exit-code');
    } catch (error) {
      if (error.status === 1) hasStagedChanges = true;
      else throw new Error(`sync staged-diff check failed: ${error.message}`);
    }
    if (hasStagedChanges) {
      try {
        git('commit', '-q', '-m', 'garden: sync');
        committed = true;
      } catch (error) {
        throw new Error(`sync commit failed: ${error.message}`);
      }
    }

    // 2. Pull then push; report failure rather than claiming remote convergence.
    let reason;
    try {
      git('pull', '--ff-only', '--quiet');
      git('push', '--quiet');
    } catch (e) {
      reason = String(e.message || e).split('\n')[0];
      return { committed, synced: false, reason };
    }

    return { committed, synced: true };
  }
}
