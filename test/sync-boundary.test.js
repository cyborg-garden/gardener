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
    assert.match(result.stderr, /no Git commit identity configured|sync (add|commit) failed/);
    assert.equal(git(root, 'status', '--porcelain'), '?? state.md\n');
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

test('R1 garden config cannot execute through a local include and filter during authorized sync', () => {
  const parent = scratch('garden-sync-local-filter-');
  try {
    const root = join(parent, 'garden');
    const remote = join(parent, 'remote.git');
    initRepo(root, remote);
    git(root, 'config', 'include.path', 'agent-config');
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'),
      'rung: R1\ncapabilities:\n  garden-io:sync: act:contained\n');
    const marker = join(parent, 'outside-filter-executed');
    for (const [path, input] of [
      ['payload.sh', `#!/bin/sh\nprintf executed > ${marker}\n`],
      ['agent-config', `[filter "payload"]\n\tclean = /bin/sh ${root}/payload.sh\n`],
      ['.gitattributes', '*.md filter=payload\n'],
      ['state.md', 'filter must not execute\n'],
    ]) {
      const write = spawnSync(process.execPath, [CLI, 'write', path], {
        input, encoding: 'utf8', env: { ...process.env, GARDEN_ROOT: root,
          GARDEN_OVERLAY_ROOT: parent, GARDEN_AUTHORITY: '', GARDEN_SYNC: 'on' },
      });
      assert.equal(write.status, 0, write.stderr);
    }
    chmodSync(join(root, 'payload.sh'), 0o755);
    const result = cli(root, parent, 'sync');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported local Git configuration/);
    assert.equal(existsSync(marker), false);
    assert.throws(() => git(root, 'show', 'HEAD:state.md'));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('R1 replacement of a configured in-garden hook cannot execute during authorized sync', () => {
  const parent = scratch('garden-sync-local-hooks-');
  try {
    const root = join(parent, 'garden');
    initRepo(root, join(parent, 'remote.git'));
    git(root, 'config', 'core.hooksPath', 'agent-hooks');
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'),
      'rung: R1\ncapabilities:\n  garden-io:sync: act:contained\n');
    const marker = join(parent, 'outside-hook-executed');
    for (const [path, input] of [
      ['agent-hooks/pre-commit', `#!/bin/sh\nprintf executed > ${marker}\n`],
      ['state.md', 'hook must not execute\n'],
    ]) {
      const write = spawnSync(process.execPath, [CLI, 'write', path], {
        input, encoding: 'utf8', env: { ...process.env, GARDEN_ROOT: root,
          GARDEN_OVERLAY_ROOT: parent, GARDEN_AUTHORITY: '', GARDEN_SYNC: 'on' },
      });
      assert.equal(write.status, 0, write.stderr);
    }
    chmodSync(join(root, 'agent-hooks/pre-commit'), 0o755);
    const result = cli(root, parent, 'sync');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported local Git configuration/);
    assert.equal(existsSync(marker), false);
    assert.throws(() => git(root, 'show', 'HEAD:state.md'));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('R1 included transport command cannot execute during authorized push', () => {
  const parent = scratch('garden-sync-local-transport-');
  try {
    const root = join(parent, 'garden');
    initRepo(root, join(parent, 'remote.git'));
    git(root, 'config', 'include.path', 'agent-config');
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'),
      'rung: R1\ncapabilities:\n  garden-io:sync: act:contained\n');
    const marker = join(parent, 'outside-transport-executed');
    for (const [path, input] of [
      ['payload.sh', `#!/bin/sh\nprintf executed > ${marker}\n`],
      ['agent-config', `[core]\n\tsshCommand = /bin/sh ${root}/payload.sh\n`],
    ]) {
      const write = spawnSync(process.execPath, [CLI, 'write', path], {
        input, encoding: 'utf8', env: { ...process.env, GARDEN_ROOT: root,
          GARDEN_OVERLAY_ROOT: parent, GARDEN_AUTHORITY: '', GARDEN_SYNC: 'on' },
      });
      assert.equal(write.status, 0, write.stderr);
    }
    chmodSync(join(root, 'payload.sh'), 0o755);
    const result = cli(root, parent, 'sync');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported local Git configuration/);
    assert.equal(existsSync(marker), false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('sync retains gitdir-conditional global identity without included executable config', () => {
  const parent = scratch('garden-sync-conditional-identity-');
  try {
    const root = join(parent, 'garden');
    const remote = join(parent, 'remote.git');
    const home = join(parent, 'home');
    const marker = join(parent, 'conditional-config-executed');
    initRepo(root, remote);
    git(root, 'config', '--unset', 'user.name');
    git(root, 'config', '--unset', 'user.email');
    mkdirSync(home);
    writeFileSync(join(home, 'identity.inc'),
      `[user]\n\tname = Conditional Operator\n\temail = operator@example.com\n[core]\n\teditor = touch ${marker}\n`);
    writeFileSync(join(home, '.gitconfig'),
      `[includeIf "gitdir:${root}/"]\n\tpath = identity.inc\n`);
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    writeFileSync(join(root, 'state.md'), 'conditional\n');
    const result = cli(root, parent, 'sync', {
      HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { committed: true, synced: true });
    assert.equal(git(root, 'log', '-1', '--format=%an <%ae>').trim(),
      'Conditional Operator <operator@example.com>');
    assert.equal(existsSync(marker), false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('local identity takes precedence over global identity in neutral sync config', () => {
  const parent = scratch('garden-sync-local-identity-precedence-');
  try {
    const root = join(parent, 'garden');
    const home = join(parent, 'home');
    initRepo(root, join(parent, 'remote.git'));
    mkdirSync(home);
    writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Global\n\temail = global@example.com\n');
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    writeFileSync(join(root, 'state.md'), 'local wins\n');
    const result = cli(root, parent, 'sync', { HOME: home, XDG_CONFIG_HOME: join(home, '.config') });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(root, 'log', '-1', '--format=%an <%ae>').trim(), 'Test <test@example.com>');
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('local submodule mapping cannot make sync read an in-garden executable config', () => {
  const parent = scratch('garden-sync-submodule-config-');
  try {
    const root = join(parent, 'garden');
    initRepo(root, join(parent, 'remote.git'));
    git(root, 'config', 'include.path', 'agent-config');
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    const marker = join(parent, 'submodule-config-executed');
    for (const [path, input] of [
      ['payload.sh', `#!/bin/sh\nprintf executed > ${marker}\n`],
      ['agent-config', `[filter "payload"]\n\tclean = /bin/sh ${root}/payload.sh\n`],
      ['.gitmodules', '[submodule "nested"]\n\tpath = nested\n\turl = ../nested\n'],
      ['.gitattributes', '*.md filter=payload\n'],
      ['state.md', 'no submodule execution\n'],
    ]) {
      const write = spawnSync(process.execPath, [CLI, 'write', path], {
        input, encoding: 'utf8', env: { ...process.env, GARDEN_ROOT: root,
          GARDEN_OVERLAY_ROOT: parent, GARDEN_AUTHORITY: '', GARDEN_SYNC: 'on' },
      });
      assert.equal(write.status, 0, write.stderr);
    }
    chmodSync(join(root, 'payload.sh'), 0o755);
    const result = cli(root, parent, 'sync');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported local Git configuration/);
    assert.equal(existsSync(marker), false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('upstream ref cannot inject an upload-pack option through pull', () => {
  const parent = scratch('garden-sync-upstream-option-');
  try {
    const root = join(parent, 'garden');
    initRepo(root, join(parent, 'remote.git'));
    const marker = join(parent, 'outside-option-executed');
    const branch = '--upload-pack=' + join(root, 'payload.sh');
    git(root, 'config', 'branch.master.merge', `refs/heads/${branch}`);
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    const write = spawnSync(process.execPath, [CLI, 'write', 'payload.sh'], {
      input: `#!/bin/sh\nprintf executed > ${marker}\n`, encoding: 'utf8',
      env: { ...process.env, GARDEN_ROOT: root, GARDEN_OVERLAY_ROOT: parent,
        GARDEN_AUTHORITY: '', GARDEN_SYNC: 'on' },
    });
    assert.equal(write.status, 0, write.stderr);
    chmodSync(join(root, 'payload.sh'), 0o755);
    const result = cli(root, parent, 'sync');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported upstream ref/);
    assert.equal(existsSync(marker), false);
    assert.throws(() => git(root, 'show', 'HEAD:payload.sh'));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('ext transport URL cannot execute even when inherited protocol policy allows ext', () => {
  const parent = scratch('garden-sync-ext-url-');
  try {
    const root = join(parent, 'garden');
    initRepo(root, join(parent, 'remote.git'));
    const marker = join(parent, 'outside-ext-executed');
    git(root, 'config', 'remote.origin.url', `ext::${join(root, 'payload.sh')} %S foo`);
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    const write = spawnSync(process.execPath, [CLI, 'write', 'payload.sh'], {
      input: `#!/bin/sh\nprintf executed > ${marker}\n`, encoding: 'utf8',
      env: { ...process.env, GARDEN_ROOT: root, GARDEN_OVERLAY_ROOT: parent,
        GARDEN_AUTHORITY: '', GARDEN_SYNC: 'on' },
    });
    assert.equal(write.status, 0, write.stderr);
    chmodSync(join(root, 'payload.sh'), 0o755);
    const result = cli(root, parent, 'sync', { GIT_ALLOW_PROTOCOL: 'ext' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported remote URL/);
    assert.equal(existsSync(marker), false);
    assert.throws(() => git(root, 'show', 'HEAD:payload.sh'));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('ext push URL is rejected before staging or execution', () => {
  const parent = scratch('garden-sync-ext-pushurl-');
  try {
    const root = join(parent, 'garden');
    initRepo(root, join(parent, 'remote.git'));
    const marker = join(parent, 'outside-ext-push-executed');
    git(root, 'config', 'remote.origin.pushurl', `ext::${join(root, 'payload.sh')} %S foo`);
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    const write = spawnSync(process.execPath, [CLI, 'write', 'payload.sh'], {
      input: `#!/bin/sh\nprintf executed > ${marker}\n`, encoding: 'utf8',
      env: { ...process.env, GARDEN_ROOT: root, GARDEN_OVERLAY_ROOT: parent,
        GARDEN_AUTHORITY: '', GARDEN_SYNC: 'on' },
    });
    assert.equal(write.status, 0, write.stderr);
    chmodSync(join(root, 'payload.sh'), 0o755);
    const result = cli(root, parent, 'sync', { GIT_ALLOW_PROTOCOL: 'ext' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported remote URL/);
    assert.equal(existsSync(marker), false);
    assert.throws(() => git(root, 'show', 'HEAD:payload.sh'));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('slash-named remote sync succeeds using the exact configured upstream', () => {
  const parent = scratch('garden-sync-slash-remote-');
  try {
    const root = join(parent, 'garden');
    const remote = join(parent, 'remote.git');
    initRepo(root, remote);
    git(root, 'remote', 'rename', 'origin', 'upstream/team');
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    writeFileSync(join(root, 'state.md'), 'slash remote\n');
    const result = cli(root, parent, 'sync');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { committed: true, synced: true });
    const clone = join(parent, 'clone');
    execFileSync('git', ['clone', '-q', remote, clone]);
    assert.equal(readFileSync(join(clone, 'state.md'), 'utf8'), 'slash remote\n');
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('fast-forward upstream changes are integrated before the local push', () => {
  const parent = scratch('garden-sync-fast-forward-');
  try {
    const root = join(parent, 'garden');
    const remote = join(parent, 'remote.git');
    initRepo(root, remote);
    const clone = join(parent, 'other');
    execFileSync('git', ['clone', '-q', remote, clone]);
    git(clone, 'config', 'user.name', 'Other');
    git(clone, 'config', 'user.email', 'other@example.com');
    writeFileSync(join(clone, 'other.md'), 'other\n');
    git(clone, 'add', 'other.md');
    git(clone, 'commit', '-qm', 'other');
    git(clone, 'push', '-q', 'origin', 'HEAD');
    git(root, 'fetch', '-q', 'origin', 'master');
    git(root, 'merge', '--ff-only', '-q', 'FETCH_HEAD');
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    writeFileSync(join(root, 'state.md'), 'local\n');
    const result = cli(root, parent, 'sync');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { committed: true, synced: true });
    const verify = join(parent, 'verify');
    execFileSync('git', ['clone', '-q', remote, verify]);
    assert.equal(readFileSync(join(verify, 'state.md'), 'utf8'), 'local\n');
    assert.equal(readFileSync(join(verify, 'other.md'), 'utf8'), 'other\n');
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('divergent upstream history is not published or reported as synchronized', () => {
  const parent = scratch('garden-sync-divergent-');
  try {
    const root = join(parent, 'garden');
    const remote = join(parent, 'remote.git');
    initRepo(root, remote);
    const clone = join(parent, 'other');
    execFileSync('git', ['clone', '-q', remote, clone]);
    git(clone, 'config', 'user.name', 'Other');
    git(clone, 'config', 'user.email', 'other@example.com');
    writeFileSync(join(clone, 'other.md'), 'other\n');
    git(clone, 'add', 'other.md');
    git(clone, 'commit', '-qm', 'other');
    git(clone, 'push', '-q', 'origin', 'HEAD');
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    writeFileSync(join(root, 'state.md'), 'local\n');
    const result = cli(root, parent, 'sync');
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.committed, true);
    assert.equal(parsed.synced, false);
    assert.equal(git(root, 'status', '--porcelain'), '');
    const verify = join(parent, 'verify');
    execFileSync('git', ['clone', '-q', remote, verify]);
    assert.equal(existsSync(join(verify, 'state.md')), false);
    assert.equal(readFileSync(join(verify, 'other.md'), 'utf8'), 'other\n');
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('detached HEAD and non-repository gardens return explicit non-success results', () => {
  const parent = scratch('garden-sync-preflight-results-');
  try {
    const root = join(parent, 'garden');
    initRepo(root, join(parent, 'remote.git'));
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    writeFileSync(join(root, 'state.md'), 'unstaged\n');
    git(root, 'checkout', '-q', '--detach');
    const detached = cli(root, parent, 'sync');
    assert.equal(detached.status, 0, detached.stderr);
    assert.deepEqual(JSON.parse(detached.stdout), {
      committed: false, synced: false, reason: 'detached-head',
    });
    assert.equal(git(root, 'status', '--porcelain'), '?? state.md\n');
    const plain = join(parent, 'plain');
    mkdirSync(plain);
    writeFileSync(join(plain, 'state.md'), 'unstaged\n');
    const missing = cli(plain, parent, 'sync');
    assert.equal(missing.status, 0, missing.stderr);
    assert.deepEqual(JSON.parse(missing.stdout), {
      committed: false, synced: false, reason: 'not-a-repo',
    });
    assert.equal(existsSync(join(plain, '.git')), false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('empty duplicate remote and merge values cannot bypass upstream cardinality', () => {
  for (const field of ['remote', 'merge']) {
    const parent = scratch(`garden-sync-empty-${field}-`);
    try {
      const root = join(parent, 'garden');
      const remote = join(parent, 'remote.git');
      initRepo(root, remote);
      if (field === 'merge') {
        git(root, 'config', 'branch.master.merge', 'refs/heads/unrelated');
        git(root, 'push', '-q', 'origin', 'HEAD:refs/heads/unrelated');
      }
      git(root, 'config', '--add', `branch.master.${field}`, '');
      const beforeMaster = git(root, 'rev-parse', 'origin/master').trim();
      mkdirSync(join(parent, '.overlay'));
      writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
      writeFileSync(join(root, 'state.md'), 'must not publish\n');
      const result = cli(root, parent, 'sync');
      assert.notEqual(result.status, 0, `${field}: ${result.stdout}`);
      assert.match(result.stderr, /unsupported upstream configuration/);
      assert.equal(git(root, 'status', '--porcelain'), '?? state.md\n');
      assert.equal(git(root, 'rev-parse', 'origin/master').trim(), beforeMaster);
      if (field === 'merge') {
        assert.equal(git(root, 'rev-parse', 'origin/unrelated').trim(), beforeMaster);
      }
    } finally { rmSync(parent, { recursive: true, force: true }); }
  }
});

test('case-distinct branch sections cannot synthesize an upstream or publish another ref', () => {
  const parent = scratch('garden-sync-case-split-upstream-');
  try {
    const root = join(parent, 'garden');
    const remote = join(parent, 'remote.git');
    initRepo(root, remote);
    git(root, 'config', 'branch.master.remote', 'origin');
    git(root, 'config', '--unset', 'branch.master.merge');
    git(root, 'config', 'branch.Master.merge', 'refs/heads/unrelated');
    git(root, 'push', '-q', 'origin', 'HEAD:refs/heads/unrelated');
    const before = git(root, 'rev-parse', 'HEAD').trim();
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    writeFileSync(join(root, 'state.md'), 'must not publish\n');
    const result = cli(root, parent, 'sync');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      committed: true, synced: false, reason: 'no upstream configured',
    });
    assert.equal(git(root, 'rev-parse', 'origin/master').trim(), before);
    assert.equal(git(root, 'rev-parse', 'origin/unrelated').trim(), before);
    const clone = join(parent, 'clone');
    execFileSync('git', ['clone', '-q', remote, clone]);
    assert.equal(existsSync(join(clone, 'state.md')), false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('in-garden local remotes cannot execute R1 receive hooks during sync', () => {
  for (const form of ['path', 'file']) {
    const parent = scratch(`garden-sync-local-remote-${form}-`);
    try {
      const root = join(parent, 'garden');
      const remote = join(root, 'remote.git');
      initRepo(root, remote);
      const before = git(root, 'rev-parse', 'origin/master').trim();
      const marker = join(parent, 'outside-receive-executed');
      mkdirSync(join(parent, '.overlay'));
      writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
      const hook = 'remote.git/hooks/pre-receive';
      const payload = `#!/bin/sh\nprintf executed > ${marker}\n`;
      writeFileSync(join(root, hook), '#!/bin/sh\nexit 0\n');
      chmodSync(join(root, hook), 0o755);
      const write = spawnSync(process.execPath, [CLI, 'write', hook], {
        input: payload, encoding: 'utf8', env: { ...process.env, GARDEN_ROOT: root,
          GARDEN_OVERLAY_ROOT: parent, GARDEN_AUTHORITY: '', GARDEN_SYNC: 'on' },
      });
      assert.equal(write.status, 0, write.stderr);
      chmodSync(join(root, hook), 0o755);
      if (form === 'file') git(root, 'remote', 'set-url', 'origin', `file://${remote}`);
      writeFileSync(join(root, 'state.md'), 'must not publish\n');
      const result = cli(root, parent, 'sync');
      assert.notEqual(result.status, 0, `${form}: ${result.stdout}`);
      assert.match(result.stderr, /remote.*inside.*garden/);
      assert.equal(existsSync(marker), false);
      assert.match(git(root, 'status', '--porcelain'), /^\?\? state\.md$/m);
      assert.doesNotMatch(git(root, 'status', '--porcelain'), /^A/m);
      assert.equal(git(root, 'rev-parse', 'origin/master').trim(), before);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  }
});

test('colon-bearing local paths cannot bypass the in-garden remote boundary', () => {
  for (const form of ['absolute', 'relative', 'pushurl']) {
    const parent = scratch(`garden-sync-colon-remote-${form}-`);
    try {
      const root = join(parent, 'garden');
      const outside = join(parent, 'outside.git');
      const remote = join(root, 'remote:review.git');
      initRepo(root, outside);
      execFileSync('git', ['init', '-q', '--bare', remote]);
      git(root, 'push', '-q', remote, 'HEAD:refs/heads/master');
      const before = git(root, 'rev-parse', 'origin/master').trim();
      const marker = join(parent, 'outside-colon-executed');
      mkdirSync(join(parent, '.overlay'));
      writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
      const hook = 'remote:review.git/hooks/pre-receive';
      writeFileSync(join(root, hook), '#!/bin/sh\nexit 0\n');
      chmodSync(join(root, hook), 0o755);
      const write = spawnSync(process.execPath, [CLI, 'write', hook], {
        input: `#!/bin/sh\nprintf executed > ${marker}\n`, encoding: 'utf8',
        env: { ...process.env, GARDEN_ROOT: root, GARDEN_OVERLAY_ROOT: parent,
          GARDEN_AUTHORITY: '', GARDEN_SYNC: 'on' },
      });
      assert.equal(write.status, 0, write.stderr);
      chmodSync(join(root, hook), 0o755);
      const url = form === 'relative' ? './remote:review.git' : remote;
      if (form === 'pushurl') git(root, 'config', 'remote.origin.pushurl', url);
      else git(root, 'remote', 'set-url', 'origin', url);
      writeFileSync(join(root, 'state.md'), 'must not publish\n');
      const result = cli(root, parent, 'sync');
      assert.notEqual(result.status, 0, `${form}: ${result.stdout}`);
      assert.match(result.stderr, /remote.*inside.*garden/);
      assert.equal(existsSync(marker), false);
      assert.doesNotMatch(git(root, 'status', '--porcelain'), /^A/m);
      assert.equal(git(root, 'rev-parse', 'origin/master').trim(), before);
      assert.equal(git(root, `--git-dir=${remote}`, 'rev-parse', 'refs/heads/master').trim(), before);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  }
});

test('an outside symlink to an in-garden remote is refused by canonical target', () => {
  const parent = scratch('garden-sync-remote-alias-');
  try {
    const root = join(parent, 'garden');
    const remote = join(root, 'nested-remote');
    initRepo(root, remote);
    const alias = join(parent, 'remote-alias');
    symlinkSync(remote, alias, 'dir');
    git(root, 'remote', 'set-url', 'origin', alias);
    mkdirSync(join(parent, '.overlay'));
    writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R2\n');
    writeFileSync(join(root, 'state.md'), 'must not publish\n');
    const result = cli(root, parent, 'sync');
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /remote.*inside.*garden/);
    assert.throws(() => git(root, 'show', 'HEAD:state.md'));
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
