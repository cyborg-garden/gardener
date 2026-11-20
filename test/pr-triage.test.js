// test/pr-triage.test.js — runs the PR-triage stage's own hermetic shell suites under
// `npm test`, so the gate workflow covers them. The suites fake gh, the registry and the
// model, trip on any real gh/curl/claude call, and prove those tripwires fire; see
// stages/pr-triage/*.test.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const [file, summary] of [
  ['stages/pr-triage/pr-triage.test.sh', /pr-triage\.test: \d+ passed, 0 failed/],
  ['stages/pr-triage/pr-triage-merge.test.sh', /pr-triage-merge\.test: \d+ passed, 0 failed/],
]) {
  test(`pr-triage stage: ${file} passes`, () => {
    const r = spawnSync('bash', [file], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, summary);
  });
}
