// test/validate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate } from '../tools/validate.js';

function garden(files) {
  const root = mkdtempSync(join(tmpdir(), 'gval-'));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}

test('valid board + decisions pass with no errors', () => {
  const root = garden({
    'state/threads.md': '## Now\n- [ ] (P1) #a1 Ship it — desc\n',
    'state/decisions.md': '## D-2026-07-11-01  needs: you\nQ\nstatus: open\n',
  });
  assert.deepEqual(validate(root), []);
  rmSync(root, { recursive: true, force: true });
});

test('a board line missing an #id is reported', () => {
  const root = garden({ 'state/threads.md': '## Now\n- [ ] no id here\n' });
  const errs = validate(root);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /threads\.md.*malformed board line/);
  rmSync(root, { recursive: true, force: true });
});

test('a decision missing a status: line is reported', () => {
  const root = garden({ 'state/decisions.md': '## D-2026-07-11-01\nQ\n' });
  const errs = validate(root);
  assert.match(errs[0], /decisions\.md.*status/);
  rmSync(root, { recursive: true, force: true });
});

import { validate as validateReal } from '../tools/validate.js';
test('the shipped example garden conforms to SPEC', () => {
  assert.deepEqual(validateReal('garden'), []);
});

// --- Issue #4: malformed board lines ---

test('uppercase [X] status is flagged as malformed', () => {
  const root = garden({ 'state/threads.md': '## Now\n- [X] #a1 Something\n' });
  const errs = validate(root);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /malformed board line/);
  rmSync(root, { recursive: true, force: true });
});

test('out-of-range (P5) priority is flagged as malformed', () => {
  const root = garden({ 'state/threads.md': '## Now\n- [ ] (P5) #a1 Something\n' });
  const errs = validate(root);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /malformed board line/);
  rmSync(root, { recursive: true, force: true });
});

test('well-formed board line produces no false positive', () => {
  const root = garden({ 'state/threads.md': '## Now\n- [ ] (P2) #a1 A title — desc\n' });
  const errs = validate(root);
  assert.deepEqual(errs, []);
  rmSync(root, { recursive: true, force: true });
});
