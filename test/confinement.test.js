// Root confinement is part of the autonomy boundary: a propose-capable caller must
// not escape the garden and rewrite the operator's grant (or any other file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GardenIO } from '../lib/garden-io.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'garden-io.js');

function fixture({ symlink = false, rootSymlink = false } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'garden-confinement-'));
  const root = join(parent, 'garden');
  const actualRoot = join(parent, 'actual-garden');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(parent, '.overlay'));
  writeFileSync(join(parent, '.overlay', 'autonomy.yml'), 'rung: R1\n');
  writeFileSync(join(root, 'state.md'), 'inside\n');
  if (rootSymlink) {
    rmSync(root, { recursive: true });
    mkdirSync(actualRoot);
    writeFileSync(join(actualRoot, 'state.md'), 'inside\n');
    symlinkSync(actualRoot, root, 'dir');
  }
  if (symlink) symlinkSync(join(parent, '.overlay'), join(root, 'escape'), 'dir');
  return { parent, root, actualRoot };
}

function cleanup({ parent }) { rmSync(parent, { recursive: true, force: true }); }
const grant = parent => readFileSync(join(parent, '.overlay', 'autonomy.yml'), 'utf8');

test('write refuses parent traversal instead of escalating the R1 overlay to R4', () => {
  const f = fixture();
  const io = new GardenIO({ root: f.root, sync: false, authority: 'propose' });
  assert.throws(() => io.write('../.overlay/autonomy.yml', 'rung: R4\n'), /outside.*root/);
  assert.equal(grant(f.parent), 'rung: R1\n');
  cleanup(f);
});

test('absolute paths cannot target the operator overlay', () => {
  const f = fixture();
  const io = new GardenIO({ root: f.root, sync: false, authority: 'act:broad' });
  assert.throws(() => io.write(join(f.parent, '.overlay', 'autonomy.yml'), 'rung: R4\n'), /outside.*root/);
  assert.equal(grant(f.parent), 'rung: R1\n');
  cleanup(f);
});

test('the shipped CLI refuses the grant-rewrite traversal and remains R1', () => {
  const f = fixture();
  const env = {
    ...process.env, GARDEN_ROOT: f.root, GARDEN_OVERLAY_ROOT: f.parent,
    GARDEN_SYNC: 'off', GARDEN_AUTHORITY: '',
  };
  const write = spawnSync(process.execPath, [CLI, 'write', '../.overlay/autonomy.yml'], {
    input: 'rung: R4\n', encoding: 'utf8', env,
  });
  assert.notEqual(write.status, 0);
  assert.match(write.stderr, /outside.*root/);
  assert.equal(grant(f.parent), 'rung: R1\n');
  const read = spawnSync(process.execPath, [CLI, 'write', 'state.md'], {
    input: 'still constrained\n', encoding: 'utf8', env,
  });
  assert.equal(read.status, 0, `${read.stdout}${read.stderr}`);
  cleanup(f);
});

test('reads cannot traverse outside the garden either', () => {
  const f = fixture();
  const io = new GardenIO({ root: f.root, sync: false });
  assert.throws(() => io.read('../.overlay/autonomy.yml'), /outside.*root/);
  assert.throws(() => io.list('..'), /outside.*root/);
  cleanup(f);
});

test('an existing directory symlink cannot redirect a write into the overlay', () => {
  const f = fixture({ symlink: true });
  const io = new GardenIO({ root: f.root, sync: false, authority: 'propose' });
  assert.throws(() => io.write('escape/autonomy.yml', 'rung: R4\n'), /outside.*root/);
  assert.equal(grant(f.parent), 'rung: R1\n');
  cleanup(f);
});

test('an existing file symlink cannot redirect a write into the overlay', () => {
  const f = fixture();
  symlinkSync(join(f.parent, '.overlay', 'autonomy.yml'), join(f.root, 'grant.yml'), 'file');
  const io = new GardenIO({ root: f.root, sync: false, authority: 'propose' });
  assert.throws(() => io.write('grant.yml', 'rung: R4\n'), /outside.*root/);
  assert.equal(grant(f.parent), 'rung: R1\n');
  cleanup(f);
});

test('dangling final symlinks cannot create files outside, absolute or relative', () => {
  for (const absolute of [false, true]) {
    const f = fixture();
    mkdirSync(join(f.parent, 'outside'));
    const target = absolute ? join(f.parent, 'outside', 'created.yml') : '../outside/created.yml';
    symlinkSync(target, join(f.root, 'escape.yml'), 'file');
    const io = new GardenIO({ root: f.root, sync: false, authority: 'propose' });
    assert.throws(() => io.write('escape.yml', 'not permitted\n'), /dangling final symlink/);
    assert.throws(() => io.read('escape.yml'), /dangling final symlink/);
    assert.equal(existsSync(join(f.parent, 'outside', 'created.yml')), false);
    cleanup(f);
  }
});

test('a dangling symlink chain cannot launder an outside target', () => {
  const f = fixture();
  mkdirSync(join(f.parent, 'outside'));
  symlinkSync('../outside/created.yml', join(f.root, 'second.yml'), 'file');
  symlinkSync('second.yml', join(f.root, 'first.yml'), 'file');
  const io = new GardenIO({ root: f.root, sync: false, authority: 'propose' });
  assert.throws(() => io.write('first.yml', 'not permitted\n'), /dangling final symlink/);
  assert.equal(existsSync(join(f.parent, 'outside', 'created.yml')), false);
  cleanup(f);
});

test('R1 CLI cannot create a sharp-edge grant through a dangling garden link', () => {
  const f = fixture();
  mkdirSync(join(f.parent, '.overlay', 'grants'));
  symlinkSync('../.overlay/grants/auto-merge', join(f.root, 'grant.yml'), 'file');
  const write = spawnSync(process.execPath, [CLI, 'write', 'grant.yml'], {
    input: 'granted\n', encoding: 'utf8', env: {
      ...process.env, GARDEN_ROOT: f.root, GARDEN_OVERLAY_ROOT: f.parent,
      GARDEN_SYNC: 'off', GARDEN_AUTHORITY: '',
    },
  });
  assert.notEqual(write.status, 0);
  assert.match(write.stderr, /dangling final symlink/);
  assert.equal(existsSync(join(f.parent, '.overlay', 'grants', 'auto-merge')), false);
  assert.equal(grant(f.parent), 'rung: R1\n');
  cleanup(f);
});

test('a missing file below a symlinked directory cannot escape either', () => {
  const f = fixture({ symlink: true });
  const io = new GardenIO({ root: f.root, sync: false, authority: 'propose' });
  assert.throws(() => io.write('escape/new-grant.yml', 'rung: R4\n'), /outside.*root/);
  assert.equal(existsSync(join(f.parent, '.overlay', 'new-grant.yml')), false);
  cleanup(f);
});

test('reads and lists refuse an outward directory symlink', () => {
  const f = fixture({ symlink: true });
  const io = new GardenIO({ root: f.root, sync: false });
  assert.throws(() => io.read('escape/autonomy.yml'), /outside.*root/);
  assert.throws(() => io.list('escape'), /outside.*root/);
  assert.throws(() => io.list(''), /outside.*root/);
  cleanup(f);
});

test('listing refuses an outward file symlink even below a safe directory', () => {
  const f = fixture();
  mkdirSync(join(f.root, 'state'));
  symlinkSync(join(f.parent, '.overlay', 'autonomy.yml'), join(f.root, 'state', 'grant.yml'), 'file');
  const io = new GardenIO({ root: f.root, sync: false });
  assert.throws(() => io.list(''), /outside.*root/);
  cleanup(f);
});

test('a symlink to a symlink cannot launder an outside target', () => {
  const f = fixture({ symlink: true });
  symlinkSync(join(f.root, 'escape'), join(f.root, 'second-hop'), 'dir');
  const io = new GardenIO({ root: f.root, sync: false, authority: 'propose' });
  assert.throws(() => io.write('second-hop/autonomy.yml', 'rung: R4\n'), /outside.*root/);
  assert.equal(grant(f.parent), 'rung: R1\n');
  cleanup(f);
});

test('an outward symlink cannot move the entire garden root', () => {
  const parent = mkdtempSync(join(tmpdir(), 'garden-root-escape-'));
  const root = join(parent, 'garden');
  symlinkSync(parent, root, 'dir');
  const io = new GardenIO({ root, sync: false, authority: 'act:broad' });
  assert.throws(() => io.write('.overlay/autonomy.yml', 'rung: R4\n'), /real directory.*symlink/);
  assert.equal(existsSync(join(parent, '.overlay')), false);
  cleanup({ parent });
});

test('an in-root directory symlink may point at a new file whose parent resolves inside', () => {
  const f = fixture();
  mkdirSync(join(f.root, 'state'));
  symlinkSync(join(f.root, 'state'), join(f.root, 'current'), 'dir');
  const io = new GardenIO({ root: f.root, sync: false, authority: 'propose' });
  io.write('current/next.md', 'safe\n');
  assert.equal(io.read('current/next.md'), 'safe\n');
  assert.equal(readFileSync(join(f.root, 'state', 'next.md'), 'utf8'), 'safe\n');
  assert.deepEqual(io.list('current'), ['current/next.md']);
  cleanup(f);
});

test('a symlinked garden root is refused rather than widening the boundary', () => {
  const f = fixture({ rootSymlink: true });
  const io = new GardenIO({ root: f.root, sync: false, authority: 'propose' });
  assert.throws(() => io.read('state.md'), /real directory.*symlink/);
  assert.throws(() => io.write('../.overlay/autonomy.yml', 'rung: R4\n'), /real directory.*symlink/);
  assert.equal(grant(f.parent), 'rung: R1\n');
  cleanup(f);
});

test('ordinary whole-garden listing works with default and explicit empty prefixes', () => {
  const f = fixture();
  const io = new GardenIO({ root: f.root, sync: false, authority: 'propose' });
  io.write('state/threads.md', '# Board\n');
  assert.deepEqual(io.list().sort(), ['state.md', 'state/threads.md']);
  assert.deepEqual(io.list('').sort(), ['state.md', 'state/threads.md']);
  const cli = spawnSync(process.execPath, [CLI, 'list'], {
    encoding: 'utf8', env: { ...process.env, GARDEN_ROOT: f.root, GARDEN_SYNC: 'off' },
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(cli.stdout.trim().split('\n').sort(), ['state.md', 'state/threads.md']);
  cleanup(f);
});

test('a missing garden or list prefix is empty rather than an exception', () => {
  const parent = mkdtempSync(join(tmpdir(), 'garden-missing-'));
  const io = new GardenIO({ root: join(parent, 'garden'), sync: false });
  assert.equal(io.read('state.md'), null);
  assert.deepEqual(io.list(), []);
  assert.deepEqual(io.list('missing'), []);
  cleanup({ parent });
});

test('symlinked root ancestors work for real and lazily-created gardens', () => {
  for (const lazy of [false, true]) {
    const parent = mkdtempSync(join(tmpdir(), 'garden-parent-alias-'));
    mkdirSync(join(parent, 'actual'));
    symlinkSync(join(parent, 'actual'), join(parent, 'logical'), 'dir');
    const root = join(parent, 'logical', 'garden');
    if (!lazy) {
      mkdirSync(root);
      writeFileSync(join(root, 'state.md'), 'inside\n');
    }
    const io = new GardenIO({ root, sync: false, authority: 'propose' });
    io.write('state/next.md', 'safe\n');
    assert.equal(io.read('state/next.md'), 'safe\n');
    assert.deepEqual(io.list('state'), ['state/next.md']);
    assert.equal(readFileSync(join(parent, 'actual', 'garden', 'state', 'next.md'), 'utf8'), 'safe\n');
    cleanup({ parent });
  }
});

test('nonexistent and syntactically invalid paths fail closed without creating anything', () => {
  const f = fixture();
  const io = new GardenIO({ root: f.root, sync: false, authority: 'act:broad' });
  assert.throws(() => io.read('a/\0b'), /outside.*root/);
  assert.throws(() => io.write('', 'x'), /outside.*root/);
  assert.throws(() => io.write('.', 'x'), /outside.*root/);
  io.write('missing', 'valid\n', { authority: 'propose' });
  assert.equal(io.read('missing'), 'valid\n');
  cleanup(f);
});
