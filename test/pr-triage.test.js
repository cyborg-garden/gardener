// test/pr-triage.test.js — runs the PR-triage stage's own hermetic shell suite under
// `npm test`, so the gate workflow covers it. The suite fakes gh, the registry and the
// model, and trips on any real gh/curl call; see stages/pr-triage/pr-triage.test.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('pr-triage stage: hermetic shell suite passes', () => {
  const r = spawnSync('bash', ['stages/pr-triage/pr-triage.test.sh'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /pr-triage\.test: \d+ passed, 0 failed/);
});
