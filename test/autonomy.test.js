// test/autonomy.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUTHORITY, RUNGS, DEFAULT_RUNG, rankOf, writeAllowed, parseOverlay, loadAutonomy,
} from '../lib/autonomy.js';
import { GardenIO } from '../lib/garden-io.js';
import { GitDriver } from '../lib/drivers/git.js';

function tempRoot() { return mkdtempSync(join(tmpdir(), 'garden-autonomy-')); }
function overlay(root, files) {
  const dir = join(root, '.overlay');
  mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const f = join(dir, rel);
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(f, content);
  }
}

// --- the ladder ---------------------------------------------------------------

test('authority ladder is ordered observe < propose < act:contained < act:broad', () => {
  assert.deepEqual(AUTHORITY, ['observe', 'propose', 'act:contained', 'act:broad']);
  assert.ok(rankOf('observe') < rankOf('propose'));
  assert.ok(rankOf('propose') < rankOf('act:contained'));
  assert.ok(rankOf('act:contained') < rankOf('act:broad'));
  assert.equal(rankOf('nonsense'), -1);
});

// --- write-policy (propose-don't-clobber) ------------------------------------

test('writeAllowed: observe never writes, human region never writable', () => {
  for (const region of ['agent', 'proposal', 'human']) {
    assert.equal(writeAllowed('observe', region), false, `observe/${region}`);
  }
  // The load-bearing guarantee: no rung may write human-owned state.
  for (const auth of AUTHORITY) {
    assert.equal(writeAllowed(auth, 'human'), false, `${auth}/human`);
  }
});

test('writeAllowed: propose+ may write proposal and agent regions', () => {
  for (const auth of ['propose', 'act:contained', 'act:broad']) {
    assert.equal(writeAllowed(auth, 'proposal'), true, `${auth}/proposal`);
    assert.equal(writeAllowed(auth, 'agent'), true, `${auth}/agent`);
  }
});

test('writeAllowed: unknown authority or region fails closed', () => {
  assert.equal(writeAllowed('root', 'agent'), false);
  assert.equal(writeAllowed('act:broad', 'mystery'), false);
});

// --- overlay parsing ----------------------------------------------------------

test('parseOverlay reads rung + capabilities, ignores comments', () => {
  const cfg = parseOverlay([
    '# my grants',
    'rung: R2   # act, attended',
    'capabilities:',
    '  triage-board: act:broad',
    '  reprioritize-roadmap: propose',
    '',
  ].join('\n'));
  assert.equal(cfg.rung, 'R2');
  assert.deepEqual(cfg.capabilities, {
    'triage-board': 'act:broad',
    'reprioritize-roadmap': 'propose',
  });
});

test('parseOverlay accepts a JSON overlay and empty input', () => {
  assert.deepEqual(parseOverlay('{"rung":"R1"}'), { rung: 'R1' });
  assert.deepEqual(parseOverlay('   '), {});
});

// --- resolution: R0 default + explicit grants --------------------------------

test('a garden with no overlay resolves to R0 (observe, attended)', () => {
  const root = tempRoot();
  const a = loadAutonomy(root);
  assert.equal(a.rung, DEFAULT_RUNG);
  assert.equal(a.rung, 'R0');
  assert.equal(a.authorityFor('anything'), 'observe');
  assert.equal(a.attended, true);
  rmSync(root, { recursive: true, force: true });
});

test('an unknown or malformed rung falls back to R0, never higher', () => {
  const root = tempRoot();
  overlay(root, { 'autonomy.yml': 'rung: R9\n' });
  assert.equal(loadAutonomy(root).authorityFor('x'), 'observe');
  rmSync(root, { recursive: true, force: true });
});

test('a granted rung raises authority; per-capability override wins', () => {
  const root = tempRoot();
  overlay(root, {
    'autonomy.yml': [
      'rung: R2',
      'capabilities:',
      '  reprioritize-roadmap: propose',
    ].join('\n'),
  });
  const a = loadAutonomy(root);
  assert.equal(a.rung, 'R2');
  assert.equal(a.attended, true);
  assert.equal(a.authorityFor('triage-board'), 'act:contained');    // rung default
  assert.equal(a.authorityFor('reprioritize-roadmap'), 'propose');  // override
  rmSync(root, { recursive: true, force: true });
});

test('R4 preset is act:broad + unattended', () => {
  assert.deepEqual(RUNGS.R4, { authority: 'act:broad', attended: false });
  assert.equal(RUNGS.R3.attended, false);
  assert.equal(RUNGS.R2.attended, true);
});

// --- the act-gate -------------------------------------------------------------

test('canAct compares granted authority against the required authority', () => {
  const root = tempRoot();
  overlay(root, { 'autonomy.yml': 'rung: R1\n' }); // propose
  const a = loadAutonomy(root);
  assert.equal(a.canAct('triage', 'propose'), true);
  assert.equal(a.canAct('triage', 'act:contained'), false);
  assert.equal(a.canAct('triage', 'not-an-authority'), false);
  rmSync(root, { recursive: true, force: true });
});

test('a sharp-edge action needs its named grant even when authority suffices', () => {
  const root = tempRoot();
  overlay(root, { 'autonomy.yml': 'rung: R4\n' }); // act:broad, top of the ladder
  let a = loadAutonomy(root);
  // Authority is high enough, but the sharp-edge token is absent → still off.
  assert.equal(a.canAct('merge-pr', 'act:broad', { grant: 'auto-merge' }), false);

  overlay(root, { 'grants/auto-merge': '' }); // operator drops the token
  a = loadAutonomy(root);
  assert.equal(a.hasGrant('auto-merge'), true);
  assert.equal(a.canAct('merge-pr', 'act:broad', { grant: 'auto-merge' }), true);
  rmSync(root, { recursive: true, force: true });
});

// --- driver integration: enforcement is unconditional ------------------------

test('git driver declares regions: decisions is a proposal surface, rest agent', () => {
  const root = tempRoot();
  const io = new GardenIO({ driver: 'git', root, sync: false });
  assert.equal(io.driver.regionOf('state/decisions.md'), 'proposal');
  assert.equal(io.driver.regionOf('state/threads.md'), 'agent');
  rmSync(root, { recursive: true, force: true });
});

// The behaviour this file used to assert was: "write without an authority stays
// permissive (existing callers unaffected)". That made the driver write-policy — the
// SECOND of the two enforcement layers, the one that is supposed to hold when the loop
// does not — opt-in per call. A jailbroken loop is exactly a caller that omits the
// argument. It is now fail-closed, and these tests pin that.

test('write with NO authority declared anywhere is refused, not permitted', () => {
  const root = tempRoot();
  const io = new GardenIO({ driver: 'git', root, sync: false, authority: undefined });
  assert.throws(() => io.write('state/threads.md', 'board\n'), /write refused/);
  assert.equal(io.read('state/threads.md'), null, 'nothing was written');
  rmSync(root, { recursive: true, force: true });
});

test('the refusal names the remedy instead of just failing', () => {
  const root = tempRoot();
  const io = new GardenIO({ driver: 'git', root, sync: false });
  assert.throws(() => io.write('state/threads.md', 'x\n'), (e) => {
    assert.match(e.message, /an absent authority is not a permission/);
    assert.match(e.message, /GARDEN_AUTHORITY/);
    assert.match(e.message, /loadAutonomy/);
    return true;
  });
  rmSync(root, { recursive: true, force: true });
});

test('a standing declaration on the driver satisfies the policy for later writes', () => {
  const root = tempRoot();
  const io = new GardenIO({ driver: 'git', root, sync: false, authority: 'act:contained' });
  io.write('state/threads.md', 'board\n');
  assert.equal(io.read('state/threads.md'), 'board\n');
  // …and the standing declaration is still a declaration, so it is still checked.
  const low = new GardenIO({ driver: 'git', root, sync: false, authority: 'observe' });
  assert.throws(() => low.write('state/threads.md', 'nope\n'), /write refused/);
  rmSync(root, { recursive: true, force: true });
});

test('a per-call authority overrides the standing declaration in both directions', () => {
  const root = tempRoot();
  const io = new GardenIO({ driver: 'git', root, sync: false, authority: 'act:broad' });
  assert.throws(() => io.write('state/threads.md', 'x\n', { authority: 'observe' }), /write refused/);
  const low = new GardenIO({ driver: 'git', root, sync: false, authority: 'observe' });
  low.write('state/threads.md', 'ok\n', { authority: 'propose' });
  assert.equal(low.read('state/threads.md'), 'ok\n');
  rmSync(root, { recursive: true, force: true });
});

test('GARDEN_AUTHORITY is a declaration, not a bypass', () => {
  const root = tempRoot();
  const prev = process.env.GARDEN_AUTHORITY;
  try {
    process.env.GARDEN_AUTHORITY = 'propose';
    new GardenIO({ driver: 'git', root, sync: false }).write('state/threads.md', 'ok\n');
    assert.equal(new GardenIO({ driver: 'git', root, sync: false }).read('state/threads.md'), 'ok\n');
    process.env.GARDEN_AUTHORITY = 'observe';
    assert.throws(
      () => new GardenIO({ driver: 'git', root, sync: false }).write('state/x.md', 'no\n'),
      /write refused/);
  } finally {
    if (prev === undefined) delete process.env.GARDEN_AUTHORITY;
    else process.env.GARDEN_AUTHORITY = prev;
    rmSync(root, { recursive: true, force: true });
  }
});

// --- the reproduction that condemned the opt-in guard ------------------------

test('a driver owning a HUMAN region refuses the write with OR without an authority', () => {
  // The exact defect: `NotionLike` is the case AUTONOMY.md is written for — "human-set
  // fields are human-owned and refused above `propose`, regardless of what the loop
  // asks". Under the old guard it refused WITH an authority and wrote WITHOUT one,
  // because the permissive default was inherited from GitDriver.
  class NotionLike extends GitDriver { regionOf() { return 'human'; } }
  const root = tempRoot();

  const d = new NotionLike({ root, sync: false });
  assert.throws(() => d.write('Status.txt', 'x', { authority: 'act:broad' }), /human region/);
  assert.throws(() => d.write('Status.txt', 'x'), /human region/);

  // No authority value exists that permits it — that is what makes it a human region.
  for (const a of AUTHORITY) {
    assert.throws(() => d.write('Status.txt', 'x', { authority: a }), /write refused/, a);
  }
  assert.equal(d.read('Status.txt'), null, 'nothing was ever written');
  rmSync(root, { recursive: true, force: true });
});

test('a driver declaring an unknown region fails closed', () => {
  class Weird extends GitDriver { regionOf() { return 'sideways'; } }
  const root = tempRoot();
  const d = new Weird({ root, sync: false, authority: 'act:broad' });
  assert.throws(() => d.write('a.md', 'x'), /write refused/);
  rmSync(root, { recursive: true, force: true });
});

test('write with an observe authority is refused by the driver', () => {
  const root = tempRoot();
  const io = new GardenIO({ driver: 'git', root, sync: false });
  assert.throws(
    () => io.write('state/threads.md', 'nope\n', { authority: 'observe' }),
    /write refused/,
  );
  assert.equal(io.read('state/threads.md'), null); // nothing was written
  rmSync(root, { recursive: true, force: true });
});

test('write with propose authority is permitted on agent/proposal regions', () => {
  const root = tempRoot();
  const io = new GardenIO({ driver: 'git', root, sync: false });
  io.write('state/decisions.md', 'D-1\n', { authority: 'propose' });
  io.write('state/threads.md', 'board\n', { authority: 'propose' });
  assert.equal(io.read('state/decisions.md'), 'D-1\n');
  assert.equal(io.read('state/threads.md'), 'board\n');
  rmSync(root, { recursive: true, force: true });
});
