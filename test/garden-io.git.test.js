// test/garden-io.git.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GardenIO } from '../lib/garden-io.js';

// These tests exercise read/list/index/resolve/sync; `write` is only their fixture
// setup. They declare a standing authority once, because the driver write-policy no
// longer treats an ABSENT authority as permission — see test/autonomy.test.js for the
// policy itself. The declaration being required here, in a file that does not care
// about autonomy, is the honest cost of making the second enforcement layer
// unconditional; it is one line, and it is explicit.
function tempGarden(authority = 'act:broad') {
  const root = mkdtempSync(join(tmpdir(), 'garden-'));
  return { io: new GardenIO({ driver: 'git', root, sync: false, authority }), root };
}

test('write then read round-trips', () => {
  const { io, root } = tempGarden();
  io.write('state/notes.md', 'hello\n');
  assert.equal(io.read('state/notes.md'), 'hello\n');
  rmSync(root, { recursive: true, force: true });
});

test('list enumerates docs under a prefix', () => {
  const { io, root } = tempGarden();
  io.write('handoffs/2026-07/a.md', 'a');
  io.write('handoffs/2026-07/b.md', 'b');
  io.write('state/x.md', 'x');
  assert.deepEqual(io.list('handoffs/').sort(), ['handoffs/2026-07/a.md', 'handoffs/2026-07/b.md']);
  rmSync(root, { recursive: true, force: true });
});

test('read of a missing doc returns null', () => {
  const { io, root } = tempGarden();
  assert.equal(io.read('nope.md'), null);
  rmSync(root, { recursive: true, force: true });
});

test('index("board") parses threads.md items', () => {
  const { io, root } = tempGarden();
  io.write('state/threads.md', '# Board\n\n## Now\n- [ ] (P1) #a1 Ship it — desc\n- [x] #a0 Done thing\n');
  const items = io.index('board');
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { lane: 'Now', status: 'open', priority: 1, id: 'a1', title: 'Ship it', desc: 'desc' });
  assert.equal(items[1].status, 'done');
  rmSync(root, { recursive: true, force: true });
});

test('index("handoffs") reads the index one-liners', () => {
  const { io, root } = tempGarden();
  io.write('handoffs/index.md', '- 2026-07-11 · example · summary here\n');
  const hs = io.index('handoffs');
  assert.equal(hs[0].date, '2026-07-11');
  assert.equal(hs[0].topic, 'example');
  rmSync(root, { recursive: true, force: true });
});

test('resolve returns the item object for a board item id', () => {
  const { io, root } = tempGarden();
  io.write('state/threads.md', '## Now\n- [ ] #a1 Ship it\n');
  assert.equal(io.resolve('#a1').id, 'a1');
  rmSync(root, { recursive: true, force: true });
});

// --- Issue #5: parser edge cases ---

test('index("board") — no-priority, no-desc row', () => {
  const { io, root } = tempGarden();
  io.write('state/threads.md', '## Backlog\n- [ ] #b1 Plain title\n');
  const items = io.index('board');
  assert.equal(items.length, 1);
  assert.equal(items[0].priority, null);
  assert.equal(items[0].desc, null);
  assert.equal(items[0].title, 'Plain title');
  rmSync(root, { recursive: true, force: true });
});

test('index("board") — [x] done row', () => {
  const { io, root } = tempGarden();
  io.write('state/threads.md', '## Done\n- [x] #d1 Finished task\n');
  const items = io.index('board');
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'done');
  rmSync(root, { recursive: true, force: true });
});

test('index("board") — title with no em-dash (no desc)', () => {
  const { io, root } = tempGarden();
  io.write('state/threads.md', '## Now\n- [ ] #c1 A simple title\n');
  const items = io.index('board');
  assert.equal(items[0].title, 'A simple title');
  assert.equal(items[0].desc, null);
  rmSync(root, { recursive: true, force: true });
});

test('index("board") — blank lines are ignored', () => {
  const { io, root } = tempGarden();
  io.write('state/threads.md', '## Now\n\n- [ ] #e1 Title\n\n');
  const items = io.index('board');
  assert.equal(items.length, 1);
  rmSync(root, { recursive: true, force: true });
});

test('resolve("#nope") returns null for unknown id', () => {
  const { io, root } = tempGarden();
  io.write('state/threads.md', '## Now\n- [ ] #a1 Ship it\n');
  assert.equal(io.resolve('#nope'), null);
  rmSync(root, { recursive: true, force: true });
});

test('index("handoffs") with two lines returns two entries', () => {
  const { io, root } = tempGarden();
  io.write('handoffs/index.md', '- 2026-07-10 · first-topic · first summary\n- 2026-07-11 · second-topic · second summary\n');
  const hs = io.index('handoffs');
  assert.equal(hs.length, 2);
  assert.equal(hs[0].date, '2026-07-10');
  assert.equal(hs[0].topic, 'first-topic');
  assert.equal(hs[1].date, '2026-07-11');
  assert.equal(hs[1].topic, 'second-topic');
  rmSync(root, { recursive: true, force: true });
});

test('sync is a no-op when disabled and never throws', () => {
  const { io, root } = tempGarden();
  assert.doesNotThrow(() => io.sync());
  rmSync(root, { recursive: true, force: true });
});

// --- Issue #1: sync() must commit locally even when no remote is configured ---
import { execFileSync } from 'node:child_process';

test('sync() commits local changes even with no remote — committed:true, synced:false', () => {
  const root = mkdtempSync(join(tmpdir(), 'garden-sync-'));
  // init a repo with a local-only git identity
  execFileSync('git', ['init', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'test']);

  const io = new GardenIO({ driver: 'git', root, sync: true, authority: 'act:broad' });
  io.write('state/notes.md', 'hello sync\n');

  const result = io.sync();

  assert.equal(result.committed, true, 'committed should be true');
  assert.equal(result.synced, false, 'synced should be false (no remote)');

  // working tree must be clean after sync
  const status = execFileSync('git', ['-C', root, 'status', '--porcelain']).toString().trim();
  assert.equal(status, '', 'working tree should be clean after sync');

  rmSync(root, { recursive: true, force: true });
});
