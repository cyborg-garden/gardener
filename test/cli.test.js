// test/cli.test.js — CLI error handling tests (Issue #2)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'garden-io.js');

function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GARDEN_SYNC: 'off' },
    ...opts,
  });
}

test('unknown index kind exits non-zero with error: on stderr, no stack trace', () => {
  const r = run(['index', 'bogus']);
  assert.notEqual(r.status, 0, 'should exit non-zero');
  assert.match(r.stderr, /^error:/m, 'stderr should start with "error:"');
  assert.doesNotMatch(r.stderr, /at \S+ \(/, 'stderr must not contain a stack trace frame');
});

test('write with no path exits 2 with error: on stderr', () => {
  const r = run(['write']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error:/m);
  assert.doesNotMatch(r.stderr, /at \S+ \(/);
});

test('read with no path exits 2 with error: on stderr', () => {
  const r = run(['read']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error:/m);
  assert.doesNotMatch(r.stderr, /at \S+ \(/);
});

test('index with no kind exits 2 with error: on stderr', () => {
  const r = run(['index']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error:/m);
  assert.doesNotMatch(r.stderr, /at \S+ \(/);
});

test('resolve with no ref exits 2 with error: on stderr', () => {
  const r = run(['resolve']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error:/m);
  assert.doesNotMatch(r.stderr, /at \S+ \(/);
});

// --- the shipped CLI path is inside the write-policy, not outside it ----------
//
// The defect this pins: bin/garden-io.js called `io.write(path, stdin)` with no opts,
// and GitDriver#write only consulted the policy `if (authority !== undefined)`. So the
// artefact's own CLI — the most reachable write path it has, and the one a jailbroken
// loop would shell out to — performed every write with the second enforcement layer
// switched off. AUTONOMY.md leans on that layer: "a jailbroken or confused loop still
// cannot mutate protected state — the driver refuses."

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

function tempCwd(overlayYml = null) {
  const cwd = mkdtempSync(join(tmpdir(), 'garden-cli-'));
  if (overlayYml !== null) {
    mkdirSync(join(cwd, '.overlay'), { recursive: true });
    writeFileSync(join(cwd, '.overlay', 'autonomy.yml'), overlayYml);
  }
  return cwd;
}

function runWrite(cwd, args = [], env = {}) {
  return spawnSync(process.execPath, [CLI, 'write', 'state/threads.md', ...args], {
    encoding: 'utf8',
    input: 'board\n',
    env: { ...process.env, GARDEN_SYNC: 'off', GARDEN_ROOT: join(cwd, 'garden'),
           GARDEN_OVERLAY_ROOT: cwd, GARDEN_AUTHORITY: '', ...env },
  });
}
const wrote = cwd => existsSync(join(cwd, 'garden', 'state', 'threads.md'));

test('CLI write with no grant anywhere is REFUSED (fail-closed, R0)', () => {
  const cwd = tempCwd();                       // no overlay at all → R0 → observe
  const r = runWrite(cwd);
  assert.notEqual(r.status, 0, `expected refusal, got:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /write refused/);
  assert.equal(wrote(cwd), false, 'nothing may be written');
  rmSync(cwd, { recursive: true, force: true });
});

test('CLI write is permitted once the operator grants a rung in the overlay', () => {
  const cwd = tempCwd('rung: R2\n');           // act:contained
  const r = runWrite(cwd);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.equal(readFileSync(join(cwd, 'garden', 'state', 'threads.md'), 'utf8'), 'board\n');
  rmSync(cwd, { recursive: true, force: true });
});

test('CLI write: a malformed overlay does not raise autonomy, it stays at R0', () => {
  const cwd = tempCwd('rung: R9\n');
  assert.notEqual(runWrite(cwd).status, 0);
  assert.equal(wrote(cwd), false);
  rmSync(cwd, { recursive: true, force: true });
});

test('CLI write: --authority is an explicit declaration and is still checked', () => {
  const low = tempCwd();
  assert.notEqual(runWrite(low, ['--authority', 'observe']).status, 0);
  assert.equal(wrote(low), false);
  rmSync(low, { recursive: true, force: true });

  const ok = tempCwd();
  assert.equal(runWrite(ok, ['--authority', 'propose']).status, 0);
  assert.equal(wrote(ok), true);
  rmSync(ok, { recursive: true, force: true });
});

// --- the usage string must describe an invocation the parser actually accepts -------
//
// The defect this pins: the usage line printed `garden-io [--authority <a>] <op> ...`,
// but `op` was bound to argv[2] before any flag was stripped. So the documented form —
// flag first — fell through to the unknown-op branch and exited 2, printing the same
// usage line it had just followed. Nothing tested the documented form, which is exactly
// how a usage string and its parser drift apart.

function runWriteLeading(cwd, leadingArgs = [], env = {}) {
  return spawnSync(process.execPath, [CLI, ...leadingArgs, 'write', 'state/threads.md'], {
    encoding: 'utf8',
    input: 'board\n',
    env: { ...process.env, GARDEN_SYNC: 'off', GARDEN_ROOT: join(cwd, 'garden'),
           GARDEN_OVERLAY_ROOT: cwd, GARDEN_AUTHORITY: '', ...env },
  });
}

test('usage documents --authority before the operation', () => {
  const r = run([]);                                  // no op at all → usage
  assert.equal(r.status, 2);
  const line = r.stderr.split('\n').find(l => l.startsWith('usage:'));
  assert.ok(line, `no usage line in:\n${r.stderr}`);
  assert.ok(
    line.indexOf('--authority') < line.indexOf('<read|write'),
    `usage documents the flag after the operation, so the tests below are pinning the ` +
    `wrong form — keep the two in step:\n${line}`
  );
});

test('the documented form `garden-io --authority <a> <op> ...` is accepted', () => {
  // No overlay anywhere: R0. If the leading flag were dropped instead of parsed, this
  // write would fail closed — so a pass here proves the flag was read, not ignored.
  const ok = tempCwd();
  const r = runWriteLeading(ok, ['--authority', 'propose']);
  assert.equal(r.status, 0, `documented invocation was rejected:\n${r.stdout}${r.stderr}`);
  assert.equal(readFileSync(join(ok, 'garden', 'state', 'threads.md'), 'utf8'), 'board\n');
  rmSync(ok, { recursive: true, force: true });
});

test('the documented form is still checked — a leading `observe` is refused', () => {
  const low = tempCwd();
  const r = runWriteLeading(low, ['--authority', 'observe']);
  assert.notEqual(r.status, 0, 'leading --authority must declare, not exempt');
  assert.match(r.stderr, /write refused/);
  assert.equal(wrote(low), false);
  rmSync(low, { recursive: true, force: true });
});

test('the documented form accepts the inline `--authority=<a>` spelling too', () => {
  const ok = tempCwd();
  assert.equal(runWriteLeading(ok, ['--authority=act:broad']).status, 0);
  assert.equal(wrote(ok), true);
  rmSync(ok, { recursive: true, force: true });

  const low = tempCwd();
  assert.notEqual(runWriteLeading(low, ['--authority=observe']).status, 0);
  assert.equal(wrote(low), false);
  rmSync(low, { recursive: true, force: true });
});

test('a leading flag with no operation after it still exits 2 with usage', () => {
  const r = run(['--authority', 'propose']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^usage:/m);
});

test('an unrecognised leading flag is refused, not taken as the op or a path', () => {
  const cwd = tempCwd('rung: R3\n');                  // grant is generous on purpose
  const r = runWriteLeading(cwd, ['--nope']);
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /^usage:/m);
  assert.equal(wrote(cwd), false, 'an unknown flag must not shift the path argument');
  rmSync(cwd, { recursive: true, force: true });
});

// This is the case the guard actually earns its keep on: leading, an unknown flag would
// exit 2 anyway via the unknown-op branch, so that test passes with the guard deleted.
// Trailing, it does not — `write --nope` bound `--nope` as the path and created it.
test('an unrecognised trailing flag is refused, not taken as the path', () => {
  const cwd = tempCwd('rung: R3\n');                  // grant is generous on purpose
  const r = spawnSync(process.execPath, [CLI, 'write', '--nope'], {
    encoding: 'utf8',
    input: 'board\n',
    env: { ...process.env, GARDEN_SYNC: 'off', GARDEN_ROOT: join(cwd, 'garden'),
           GARDEN_OVERLAY_ROOT: cwd, GARDEN_AUTHORITY: '' },
  });
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /^usage:/m);
  assert.equal(existsSync(join(cwd, 'garden', '--nope')), false,
    'an unknown flag must never become a path');
  rmSync(cwd, { recursive: true, force: true });
});

test('CLI write: GARDEN_AUTHORITY declares, and a bogus value fails closed', () => {
  const ok = tempCwd();
  assert.equal(runWrite(ok, [], { GARDEN_AUTHORITY: 'act:broad' }).status, 0);
  assert.equal(wrote(ok), true);
  rmSync(ok, { recursive: true, force: true });

  const bogus = tempCwd();
  assert.notEqual(runWrite(bogus, [], { GARDEN_AUTHORITY: 'root' }).status, 0);
  assert.equal(wrote(bogus), false);
  rmSync(bogus, { recursive: true, force: true });
});
