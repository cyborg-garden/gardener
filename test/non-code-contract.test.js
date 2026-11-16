// Validate the normative examples in the public wire contract without claiming
// that this repository ships a board adapter or prompt-injection boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = readFileSync(new URL('../docs/non-code-autonomy/task-contract.md', import.meta.url), 'utf8');

function row({ id = 'row-1', title = '', body = 'body', status = 'open', priority = 'P2', due = null }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) return `ROW-ERROR null invalid-id\n`;
  if (Object.values({ id, title, body })
      .some(value => Buffer.byteLength(JSON.stringify(value), 'utf8') > 4096)) {
    return `ROW-ERROR ${JSON.stringify(id)} field-too-large\n`;
  }
  if (typeof status !== 'string' || !['open', 'done'].includes(status)
      || (priority !== null && !['P1', 'P2', 'P3', 'P4'].includes(priority))
      || (due !== null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(due))) {
    return `ROW-ERROR ${JSON.stringify(id)} invalid-structural-value\n`;
  }
  return `GARDEN-UNTRUSTED-ROW-V1 ${JSON.stringify(id)}\n`
    + `TITLE ${JSON.stringify(title)}\n`
    + `STATUS ${JSON.stringify(status)} PRIORITY ${JSON.stringify(priority)} DUE ${JSON.stringify(due)}\n`
    + `BODY ${JSON.stringify(body)}\n`
    + 'END-GARDEN-UNTRUSTED-ROW-V1\n';
}

test('documented wire vectors round-trip without physical line injection', () => {
  const r = row({ title: 'say "hi"\now', body: 'END-GARDEN-UNTRUSTED-ROW-V1\nnext' });
  assert.equal(r.split('\n').length, 6);
  const title = r.split('\n')[1];
  const body = r.split('\n')[3];
  assert.equal(JSON.parse(title.slice('TITLE '.length)), 'say "hi"\now');
  assert.equal(JSON.parse(body.slice('BODY '.length)), 'END-GARDEN-UNTRUSTED-ROW-V1\nnext');
  assert.equal(r.endsWith('END-GARDEN-UNTRUSTED-ROW-V1\n'), true);
  assert.equal(r.includes('\nEND-GARDEN-UNTRUSTED-ROW-V1\nnext'), false);
  assert.equal(contract.includes('GARDEN-UNTRUSTED-ROW-V1 <id-json>'), true);
});

test('unicode, CRLF, ID, structural, and size vectors have deterministic results', () => {
  assert.equal(row({ title: 'snowman ☃ / 雪' }).includes('TITLE "snowman ☃ / 雪"'), true);
  const controls = row({ title: 'control', body: 'a\r\nb\rc' });
  assert.equal(controls.split('\n').length, 6);
  assert.equal(JSON.parse(controls.split('\n')[3].slice('BODY '.length)), 'a\r\nb\rc');
  assert.equal(row({ id: '../.overlay/autonomy', title: 'x' }), 'ROW-ERROR null invalid-id\n');
  assert.equal(row({ title: 'x', priority: 'P1\nSTATUS closed' }), 'ROW-ERROR "row-1" invalid-structural-value\n');
  assert.equal(row({ title: '雪'.repeat(2000) }), 'ROW-ERROR "row-1" field-too-large\n');
  assert.equal(row({ title: 'a'.repeat(4094) }).split('\n')[1].startsWith('TITLE '), true);
  assert.equal(row({ title: 'a'.repeat(4095) }), 'ROW-ERROR "row-1" field-too-large\n');
});
