// Sync mutates a Git repository and may contact a remote. It is not a read
// operation, and Git metadata is never an agent-owned garden document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GardenIO } from '../lib/garden-io.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'garden-io.js');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
function scratch(prefix) { return mkdtempSync(join(tmpdir(), prefix)); }
function initRepo(root, remote) {
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', remote]);
  execFileSync('git', ['init', '-q', root]);
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'remote', 'add', 'origin', remote);
  writeFileSync(join(root, 'README.md'), 'initial\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-qm', 'initial');
  git(root, 'push', '-qu', 'origin', 'HEAD');
}
function cli(root, parent, ...args) {
  const extraEnv = typeof args.at(-1) === 'object' ? args.pop() : {};
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GARDEN_ROOT: root, GARDEN_OVERLAY_ROOT: parent,
      GARDEN_AUTHORITY: '', GARDEN_SYNC: 'on', ...extraEnv },
  });
}

test('R1 cannot write .git/config and turn sync into command execution', () => {
  const parent = scratch('garden-r1-sync-command-');
  try {
    const root = join(parent, 'garden');
    const remote = join(parent, 'remote.git');
    initRepo(root, remote);
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R1\n');
    const marker = join(parent, 'outside-executed');
    const config = readFileSync(join(root, '.git', 'config'), 'utf8')
      .replace('[user]', `\tsshCommand = /bin/sh ${root}/payload.sh\n[user]`)
      .replace(`url = ${remote}`, `url = ${remote}\n\tpushurl = ssh://example.invalid/repo`);
    for (const [path, input] of [
      ['payload.sh', `#!/bin/sh\nprintf executed > ${marker}\n`],
      ['.git/config', config],
    ]) {
      const result = spawnSync(process.execPath, [CLI, 'write', path], {
        input, encoding: 'utf8', env: { ...process.env, GARDEN_ROOT: root,
          GARDEN_OVERLAY_ROOT: parent, GARDEN_AUTHORITY: '', GARDEN_SYNC: 'on' },
      });
      if (path === '.git/config') {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Git metadata is not agent-accessible/);
      } else assert.equal(result.status, 0, result.stderr);
    }
    const result = cli(root, parent, 'sync');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /sync requires act:contained/);
    assert.equal(existsSync(marker), false, 'R1 must not execute a payload');
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('R0 sync cannot commit or publish files from an enclosing repository', () => {
  const parent = scratch('garden-r0-nested-sync-');
  try {
    const repo = join(parent, 'repo');
    const root = join(repo, 'garden');
    const remote = join(parent, 'remote.git');
    initRepo(repo, remote);
    mkdirSync(root);
    writeFileSync(join(root, 'state.md'), 'garden\n');
    writeFileSync(join(repo, 'operator-only.txt'), 'must not be committed\n');
    const before = git(repo, 'rev-parse', 'HEAD').trim();
    const result = cli(root, parent, 'sync');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /sync requires act:contained/);
    assert.equal(git(repo, 'rev-parse', 'HEAD').trim(), before);
    assert.throws(() => git(repo, 'show', 'HEAD:operator-only.txt'));
    const clone = join(parent, 'clone');
    execFileSync('git', ['clone', '-q', remote, clone]);
    assert.equal(existsSync(join(clone, 'operator-only.txt')), false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('even authorized sync refuses a nested garden repository before mutation', () => {
  const parent = scratch('garden-authorized-nested-sync-');
  try {
    const repo = join(parent, 'repo');
    const root = join(repo, 'garden');
    const remote = join(parent, 'remote.git');
    initRepo(repo, remote);
    mkdirSync(root);
    writeFileSync(join(root, 'state.md'), 'garden\n');
    writeFileSync(join(repo, 'operator-only.txt'), 'must not be committed\n');
    const before = git(repo, 'rev-parse', 'HEAD').trim();
    const result = cli(root, parent, 'sync', '--authority', 'act:contained');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /repository root does not match garden root/);
    assert.equal(git(repo, 'rev-parse', 'HEAD').trim(), before);
    assert.throws(() => git(repo, 'show', 'HEAD:operator-only.txt'));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('sync requires act:contained even at R1 and supports an authorized exact root', () => {
  const parent = scratch('garden-authorized-sync-');
  try {
    const root = join(parent, 'garden');
    initRepo(root, join(parent, 'remote.git'));
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R1\n');
    writeFileSync(join(root, 'state.md'), 'one\n');
    assert.notEqual(cli(root, parent, 'sync').status, 0);
    assert.equal(git(root, 'status', '--porcelain'), '?? state.md\n');
    const direct = new GardenIO({ root, sync: true, authority: 'propose' });
    assert.throws(() => direct.sync(), /sync requires act:contained/);
    assert.equal(git(root, 'status', '--porcelain'), '?? state.md\n');
    const result = cli(root, parent, 'sync', '--authority', 'act:contained');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { committed: true, synced: true });
    assert.equal(git(root, 'status', '--porcelain'), '');
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('sync does not report success when commit identity is unavailable', () => {
  const parent = scratch('garden-sync-missing-identity-');
  try {
    const root = join(parent, 'garden');
    const remote = join(parent, 'remote.git');
    initRepo(root, remote);
    git(root, 'config', '--unset', 'user.name');
    git(root, 'config', '--unset', 'user.email');
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    writeFileSync(join(root, 'state.md'), 'unpublished\n');
    const result = cli(root, parent, 'sync', {
      HOME: join(parent, 'empty-home'), XDG_CONFIG_HOME: join(parent, 'empty-config'),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /sync (add|commit) failed/);
    assert.equal(git(root, 'status', '--porcelain'), 'A  state.md\n');
    execFileSync('git', ['clone', '-q', remote, join(parent, 'clone')]);
    assert.equal(existsSync(join(parent, 'clone', 'state.md')), false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('sync surfaces a failing pre-commit hook instead of pushing stale HEAD', () => {
  const parent = scratch('garden-sync-hook-failure-');
  try {
    const root = join(parent, 'garden');
    const remote = join(parent, 'remote.git');
    initRepo(root, remote);
    const hook = join(root, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    chmodSync(hook, 0o755);
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    writeFileSync(join(root, 'state.md'), 'unpublished\n');
    const result = cli(root, parent, 'sync');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /sync commit failed/);
    assert.equal(git(root, 'status', '--porcelain'), 'A  state.md\n');
    execFileSync('git', ['clone', '-q', remote, join(parent, 'clone')]);
    assert.equal(existsSync(join(parent, 'clone', 'state.md')), false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('sync preserves global commit identity without other global config', () => {
  const parent = scratch('garden-sync-global-identity-');
  try {
    const root = join(parent, 'garden');
    const remote = join(parent, 'remote.git');
    const home = join(parent, 'home');
    initRepo(root, remote);
    git(root, 'config', '--unset', 'user.name');
    git(root, 'config', '--unset', 'user.email');
    mkdirSync(home);
    const globalConfig = join(home, '.gitconfig');
    writeFileSync(globalConfig, '[user]\n\tname = Global Operator\n\temail = operator@example.com\n[core]\n\teditor = false\n');
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    writeFileSync(join(root, 'state.md'), 'committed\n');
    const result = cli(root, parent, 'sync', { HOME: home, XDG_CONFIG_HOME: join(home, '.config') });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { committed: true, synced: true });
    assert.equal(git(root, 'log', '-1', '--format=%an <%ae>').trim(), 'Global Operator <operator@example.com>');
    execFileSync('git', ['clone', '-q', remote, join(parent, 'clone')]);
    assert.equal(readFileSync(join(parent, 'clone', 'state.md'), 'utf8'), 'committed\n');
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('sync preserves included global commit identity without included executable config', () => {
  const parent = scratch('garden-sync-included-identity-');
  try {
    const root = join(parent, 'garden');
    const remote = join(parent, 'remote.git');
    const home = join(parent, 'home');
    const marker = join(parent, 'included-config-executed');
    initRepo(root, remote);
    git(root, 'config', '--unset', 'user.name');
    git(root, 'config', '--unset', 'user.email');
    mkdirSync(home);
    writeFileSync(join(home, 'identity.inc'),
      `[user]\n\tname = Included Operator\n\temail = operator@example.com\n[core]\n\teditor = touch ${marker}\n`);
    writeFileSync(join(home, '.gitconfig'), '[include]\n\tpath = identity.inc\n');
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    writeFileSync(join(root, 'state.md'), 'included\n');
    const result = cli(root, parent, 'sync', { HOME: home, XDG_CONFIG_HOME: join(home, '.config') });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { committed: true, synced: true });
    assert.equal(git(root, 'log', '-1', '--format=%an <%ae>').trim(),
      'Included Operator <operator@example.com>');
    assert.equal(existsSync(marker), false);
    execFileSync('git', ['clone', '-q', remote, join(parent, 'clone')]);
    assert.equal(readFileSync(join(parent, 'clone', 'state.md'), 'utf8'), 'included\n');
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('a clean conventional repository still performs a no-op sync', () => {
  const parent = scratch('garden-sync-noop-');
  try {
    const root = join(parent, 'garden');
    initRepo(root, join(parent, 'remote.git'));
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    const result = cli(root, parent, 'sync');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { committed: false, synced: true });
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('Git metadata is excluded from ordinary read, write, and recursive listing', () => {
  const root = scratch('garden-git-metadata-');
  try {
    execFileSync('git', ['init', '-q', root]);
    writeFileSync(join(root, 'state.md'), 'public\n');
    const io = new GardenIO({ root, sync: false, authority: 'act:broad' });
    for (const p of ['.git', '.git/config', '.git/hooks/pre-commit', 'nested/.git/config']) {
      assert.throws(() => io.read(p), /Git metadata is not agent-accessible/);
      assert.throws(() => io.write(p, 'bad\n'), /Git metadata is not agent-accessible/);
    }
    assert.deepEqual(io.list(), ['state.md']);
    assert.throws(() => io.list('.git'), /Git metadata is not agent-accessible/);
    symlinkSync(join(root, '.git'), join(root, 'metadata-alias'), 'dir');
    symlinkSync(join(root, '.git', 'config'), join(root, 'config-alias'), 'file');
    for (const p of ['config-alias', 'metadata-alias/config']) {
      assert.throws(() => io.read(p), /Git metadata is not agent-accessible/);
      assert.throws(() => io.write(p, 'bad\n'), /Git metadata is not agent-accessible/);
    }
    assert.throws(() => io.list(), /Git metadata is not agent-accessible/);
    assert.throws(() => io.list('metadata-alias'), /Git metadata is not agent-accessible/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('listing detects self and ancestor symlink cycles without ELOOP', () => {
  const root = scratch('garden-list-cycles-');
  try {
    mkdirSync(join(root, 'state', 'nested'), { recursive: true });
    writeFileSync(join(root, 'state', 'nested', 'ok.md'), 'ok\n');
    symlinkSync('.', join(root, 'self'), 'dir');
    symlinkSync('..', join(root, 'state', 'nested', 'ancestor'), 'dir');
    const io = new GardenIO({ root, sync: false });
    assert.doesNotThrow(() => io.list());
    assert.deepEqual(io.list(), ['state/nested/ok.md']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('cycle detection preserves distinct safe symlink alias listings', () => {
  const root = scratch('garden-safe-list-aliases-');
  try {
    mkdirSync(join(root, 'state'));
    writeFileSync(join(root, 'state', 'doc.md'), 'ok\n');
    symlinkSync('state', join(root, 'current'), 'dir');
    const io = new GardenIO({ root, sync: false });
    assert.deepEqual(io.list('current'), ['current/doc.md']);
    assert.deepEqual(io.list().sort(), ['current/doc.md', 'state/doc.md']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('operator-granted sync uses the separate capability, not the write capability', () => {
  const parent = scratch('garden-sync-capability-');
  try {
    const root = join(parent, 'garden');
    initRepo(root, join(parent, 'remote.git'));
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'),
      'rung: R1\ncapabilities:\n  garden-io:sync: act:contained\n');
    writeFileSync(join(root, 'state.md'), 'one\n');
    const result = cli(root, parent, 'sync');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { committed: true, synced: true });
    const write = spawnSync(process.execPath, [CLI, 'write', 'another.md'], {
      input: 'ok\n', encoding: 'utf8', env: { ...process.env, GARDEN_ROOT: root,
        GARDEN_OVERLAY_ROOT: parent, GARDEN_AUTHORITY: '', GARDEN_SYNC: 'off' },
    });
    assert.equal(write.status, 0, write.stderr);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('inherited Git config and directory redirects cannot select an outside repository', () => {
  const parent = scratch('garden-sync-env-boundary-');
  try {
    const root = join(parent, 'garden');
    const other = join(parent, 'other');
    initRepo(root, join(parent, 'remote.git'));
    initRepo(other, join(parent, 'other-remote.git'));
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R4\n');
    const before = git(other, 'rev-parse', 'HEAD').trim();
    const result = cli(root, parent, 'sync', {
      GIT_DIR: join(other, '.git'), GIT_WORK_TREE: other,
      GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.sshCommand',
      GIT_CONFIG_VALUE_0: '/bin/false', GIT_CONFIG_KEY_1: 'core.hooksPath',
      GIT_CONFIG_VALUE_1: join(parent, 'outside-hooks'),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { committed: false, synced: true });
    assert.equal(git(other, 'rev-parse', 'HEAD').trim(), before);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('separate Git metadata cannot be modified by a later authorized sync', () => {
  const parent = scratch('garden-separate-git-dir-');
  try {
    const root = join(parent, 'garden');
    const metadata = join(root, 'repo-metadata');
    const remote = join(parent, 'remote.git');
    mkdirSync(root, { recursive: true });
    execFileSync('git', ['init', '-q', '--separate-git-dir', metadata, root]);
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'remote', 'add', 'origin', remote);
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R1\n');
    const marker = join(parent, 'outside-executed');
    const payload = `#!/bin/sh\nprintf executed > ${marker}\n`;
    for (const [path, input] of [
      ['payload.sh', payload],
      ['repo-metadata/config', readFileSync(join(metadata, 'config'), 'utf8')
        .replace('[user]', `\tsshCommand = /bin/sh ${root}/payload.sh\n[user]`)
        .replace(`url = ${remote}`, `url = ${remote}\n\tpushurl = ssh://example.invalid/repo`)],
    ]) {
      const result = spawnSync(process.execPath, [CLI, 'write', path], {
        input, encoding: 'utf8', env: { ...process.env, GARDEN_ROOT: root,
          GARDEN_OVERLAY_ROOT: parent, GARDEN_AUTHORITY: '', GARDEN_SYNC: 'on' },
      });
      if (path === 'repo-metadata/config') {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /non-conventional Git layout/);
      } else {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /non-conventional Git layout/);
      }
    }
    const authorized = cli(root, parent, 'sync', '--authority', 'act:contained');
    assert.notEqual(authorized.status, 0);
    assert.match(authorized.stderr, /non-conventional Git layout/);
    assert.equal(existsSync(marker), false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('shared commondir metadata cannot execute through a later authorized sync', () => {
  const parent = scratch('garden-shared-metadata-');
  try {
    const root = join(parent, 'garden');
    const metadata = join(root, 'repo-metadata');
    initRepo(root, join(parent, 'remote.git'));
    renameSync(join(root, '.git'), metadata);
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'commondir'), '../repo-metadata\n');
    for (const name of ['config', 'description']) {
      renameSync(join(metadata, name), join(root, '.git', name));
    }
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R1\n');
    const marker = join(parent, 'outside-executed');
    mkdirSync(join(metadata, 'hooks'), { recursive: true });
    writeFileSync(join(metadata, 'hooks', 'pre-commit'), '#!/bin/sh\n');
    const result = spawnSync(process.execPath, [CLI, 'write', 'repo-metadata/hooks/pre-commit'], {
      input: `#!/bin/sh\nprintf executed > ${marker}\n`, encoding: 'utf8',
      env: { ...process.env, GARDEN_ROOT: root, GARDEN_OVERLAY_ROOT: parent,
        GARDEN_AUTHORITY: '', GARDEN_SYNC: 'on' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /non-conventional Git layout/);
    assert.throws(() => new GardenIO({ root, sync: false }).list(), /non-conventional Git layout/);
    const sync = cli(root, parent, 'sync', '--authority', 'act:contained');
    assert.notEqual(sync.status, 0);
    assert.equal(existsSync(marker), false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('a symlinked .git marker cannot make its target an agent-writable directory', () => {
  const parent = scratch('garden-symlinked-git-marker-');
  try {
    const root = join(parent, 'garden');
    const metadata = join(root, 'repo-metadata');
    initRepo(root, join(parent, 'remote.git'));
    renameSync(join(root, '.git'), metadata);
    symlinkSync('repo-metadata', join(root, '.git'), 'dir');
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R1\n');
    for (const op of ['read', 'write']) {
      const result = spawnSync(process.execPath, [CLI, op, 'repo-metadata/config'], {
        input: '[core]\n', encoding: 'utf8', env: { ...process.env, GARDEN_ROOT: root,
          GARDEN_OVERLAY_ROOT: parent, GARDEN_AUTHORITY: '', GARDEN_SYNC: 'on' },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /non-conventional Git layout/);
    }
    assert.throws(() => new GardenIO({ root, sync: false }).list(), /non-conventional Git layout/);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('a worktree .git file is not a license to use enclosing repository metadata', () => {
  const parent = scratch('garden-worktree-boundary-');
  try {
    const main = join(parent, 'main');
    const root = join(parent, 'linked');
    const remote = join(parent, 'remote.git');
    initRepo(main, remote);
    git(main, 'worktree', 'add', '-q', root);
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R4\n');
    const result = cli(root, parent, 'sync');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /non-conventional Git layout/);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
