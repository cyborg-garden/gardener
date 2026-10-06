// test/sanitize-scan.test.js — the GATE, not the library.
//
// test/particulars.test.js exercises tools/particulars.js as a module. That left the
// thing that actually runs in anger untested: the shell script could have been gutted to
// `echo "✓ sanitize scan clean"` — every Layer-1 grep deleted, the Layer-2 invocation
// replaced by `true` — and the suite would still have passed 66/66. Everything here
// invokes tools/sanitize-scan.sh as a subprocess and asserts on its EXIT CODE.
//
// Each case builds a throwaway git repo, copies the gate into it, and scans that.
//
// Two conventions keep this file from failing the gate it tests:
//   * Layer-2 fixtures carry an inline `sanitize:allow` — a per-line, diff-visible mark.
//   * Layer-1 shapes have NO suppression mechanism by design (a credential shape should
//     never be waveable through), so they are ASSEMBLED AT RUNTIME from fragments and
//     never appear as literals. `tools/sanitize-scan.sh` does exactly this to itself for
//     its own PEM and framework patterns; SHAPES below is the same trick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = process.cwd();

// Layer-1 shapes, assembled so no literal of them exists in this file. See the header.
const j = (...parts) => parts.join('');
const SHAPES = {
  'home-path': j('/', 'Users', '/', 'someone', '/notes'),
  tailnet: j('ssh box.tail1234.', 'ts', '.', 'net'),
  privatekey: j('-----', 'BEGIN', ' RSA PRIVATE KEY', '-----'),
  uuid: j('id: 3f2504e0', '-4f89', '-11d3', '-9a0c', '-', '0305e82c3301'),
  phone: j('call ', '+', '12025550143'),
  framework: j('built on ', 'egr', 'egore'),
};

// A repo containing the real gate and the real config, plus whatever files the case needs.
function gateRepo(files = {}, config = null) {
  const root = mkdtempSync(join(tmpdir(), 'garden-gate-'));
  execFileSync('git', ['-C', root, 'init', '-q']);
  mkdirSync(join(root, 'tools'), { recursive: true });
  cpSync(join(REPO, 'tools/sanitize-scan.sh'), join(root, 'tools/sanitize-scan.sh'));
  cpSync(join(REPO, 'tools/particulars.js'), join(root, 'tools/particulars.js'));
  cpSync(join(REPO, 'sanitize.particulars.json'), join(root, 'sanitize.particulars.json'));
  // package.json carries "type": "module" — particulars.js is ESM.
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  if (config) writeFileSync(join(root, 'sanitize.particulars.json'), JSON.stringify(config));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  // -N: tracked for `git ls-files` without needing a commit or a configured identity.
  execFileSync('git', ['-C', root, 'add', '-N', '.']);
  return root;
}

// Absolute, so a case that strips PATH (the fail-closed one) can still start the shell.
const BASH = (() => {
  const r = spawnSync('sh', ['-c', 'command -v bash'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '/bin/bash';
})();

function runGate(root, args = [], env = {}) {
  const r = spawnSync(BASH, [join(root, 'tools/sanitize-scan.sh'), ...args],
    { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// The shipped config lists an inverted fixture that these throwaway repos do not have,
// which would (correctly) fail the gate for the wrong reason. Cases that do not care
// about the inversion use this.
const NO_FIXTURE = { expect_findings: [] };

// --- the gate runs, and its exit code is the whole product --------------------

test('gate: a clean tree exits 0', () => {
  const root = gateRepo({ 'a.md': '# notes\nnothing identifying here at all.\n' }, NO_FIXTURE);
  const { code, out } = runGate(root);
  assert.equal(code, 0, out);
  assert.match(out, /sanitize scan clean/);
  rmSync(root, { recursive: true, force: true });
});

test('gate: this repo\'s own tree passes end to end', () => {
  const r = spawnSync('bash', ['tools/sanitize-scan.sh'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

// --- Layer 2 is actually wired in, and no directory escapes it ----------------

test('gate: a particular anywhere in the tree exits 1', () => {
  const root = gateRepo({ 'a.md': 'Hire Dorian at AcmeOrg/registry for $50,000\n' }, NO_FIXTURE);  // sanitize:allow
  const { code, out } = runGate(root);
  assert.equal(code, 1);
  assert.match(out, /SANITIZE FAIL \[particulars\]/);
  rmSync(root, { recursive: true, force: true });
});

test('gate: test/ is NOT an escape hatch — the same content there also exits 1', () => {
  // The exact reproduction that condemned `skip_paths: ["test/"]`: identical content
  // failed in garden/ and passed green under test/.
  const content = 'Hire Dorian at AcmeOrg/registry for $50,000 — dorian@acme.dev\n';  // sanitize:allow
  for (const rel of ['garden/leak.md', 'test/leak.test.js', 'test/fixtures/leak.md']) {
    const root = gateRepo({ [rel]: content }, NO_FIXTURE);
    const { code, out } = runGate(root);
    assert.equal(code, 1, `${rel} must fail the gate\n${out}`);
    assert.match(out, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    rmSync(root, { recursive: true, force: true });
  }
});

test('gate: an allow substring on the line does not clear the rest of the line', () => {
  const root = gateRepo(
    { 'a.md': 'Hire Dorian at AcmeOrg/registry — docs at example.com\n' }, NO_FIXTURE);  // sanitize:allow
  const { code, out } = runGate(root);
  assert.equal(code, 1, out);
  assert.match(out, /Dorian/);
  rmSync(root, { recursive: true, force: true });
});

// --- the inline marker cannot be stretched over a whole file ------------------
//
// `sanitize:allow` clears "the line it is on". On a file with NO newlines — minified JS,
// a one-line JSON blob, anything written without a trailing newline — the file IS the
// line, so one marker used to turn the entire file green at the gate. Layer 2 now
// refuses the marker above `marker_max_line`; these cases assert that at the exit code,
// because the exit code is the product.

// Assembled at runtime: no fragment is a particular on its own, and no line of this file
// has to be over the budget to carry the fixture.
const MARK = j('sanitize', ':', 'allow');
const LEAK = j('Hire ', 'Dorian', ' at ', 'AcmeOrg', '/registry for ', '$5', '0,000');

test('gate: a marker in a newline-free file does not clear the file (exit 1)', () => {
  const blob = `/*${MARK}*/!function(e){var t="${'a'.repeat(280)}";return t}(); // ${LEAK}`;
  assert.equal(blob.includes('\n'), false, 'the fixture must be a single line, no newline');
  const root = gateRepo({ 'bundle.min.js': blob }, NO_FIXTURE);
  const { code, out } = runGate(root);
  assert.equal(code, 1, `a marker must not green-light a whole minified file\n${out}`);
  assert.match(out, /bundle\.min\.js/);
  assert.match(out, /REFUSED/, 'the gate must say the marker was refused, not just fail');
  rmSync(root, { recursive: true, force: true });
});

test('gate: the marker still works on an ordinary line, newline or not', () => {
  // The budget must not have broken the mechanism it bounds — including on the
  // no-trailing-newline case, which is only a problem when the line is also enormous.
  const root = gateRepo({ 'a.md': `${LEAK}  <!-- ${MARK} -->` }, NO_FIXTURE);
  const { code, out } = runGate(root);
  assert.equal(code, 0, `a short unterminated line is still a line a reviewer reads\n${out}`);
  rmSync(root, { recursive: true, force: true });
});

// --- the inversion fails closed in the gate, not just in the library ----------

test('gate: an expect_findings fixture that goes quiet exits 1', () => {
  const cfg = { expect_findings: ['fixture.md'] };
  const flagged = gateRepo({ 'fixture.md': 'Hire Dorian at AcmeOrg/registry\n' }, cfg);  // sanitize:allow
  assert.equal(runGate(flagged).code, 0);
  rmSync(flagged, { recursive: true, force: true });

  const quiet = gateRepo({ 'fixture.md': 'nothing here\n' }, cfg);
  const { code, out } = runGate(quiet);
  assert.equal(code, 1, out);
  assert.match(out, /expect_findings/);
  rmSync(quiet, { recursive: true, force: true });
});

// --- Layer 1: every pattern actually matches ---------------------------------

test('gate: each Layer-1 pattern fires on its own shape', () => {
  for (const [label, shape] of Object.entries(SHAPES)) {
    const root = gateRepo({ 'a.md': `${shape}\n` }, NO_FIXTURE);
    const { code, out } = runGate(root);
    assert.equal(code, 1, `${label} must fail the gate\n${out}`);
    assert.match(out, new RegExp(`SANITIZE FAIL \\[${label}\\]`), out);
    rmSync(root, { recursive: true, force: true });
  }
});

test('gate: the privatekey pattern is not swallowed as a grep option', () => {
  // The regression: the PEM header was passed to grep POSITIONALLY, so its leading
  // dashes were parsed as options; grep errored, 2>/dev/null hid the error, and a real
  // key in the tracked tree produced a fully green gate. `grep … -e "$3"` is the fix.
  const pem = [SHAPES.privatekey, 'MIIBOgIBAAJBAK', j('-----', 'END', ' RSA PRIVATE KEY', '-----')].join('\n');
  const root = gateRepo({ 'key.pem': `${pem}\n` }, NO_FIXTURE);
  const { code, out } = runGate(root);
  assert.equal(code, 1, out);
  assert.match(out, /SANITIZE FAIL \[privatekey\]/);
  assert.doesNotMatch(out, /unrecognized option/);
  rmSync(root, { recursive: true, force: true });
});

test('gate: a hit in an early xargs batch is not lost to the last grep\'s exit status', () => {
  // Layer 1 tests grep's OUTPUT, not its status, because xargs splits a long file list
  // into several greps and the pipeline reports only the last one.
  const files = { 'aaa-leak.md': `${SHAPES.tailnet}\n` };
  for (let i = 0; i < 400; i++) files[`pad/f${String(i).padStart(4, '0')}.md`] = 'clean prose\n';
  const root = gateRepo(files, NO_FIXTURE);
  const { code, out } = runGate(root);
  assert.equal(code, 1, out);
  assert.match(out, /SANITIZE FAIL \[tailnet\]/);
  rmSync(root, { recursive: true, force: true });
});

// --- fail-closed when half the gate cannot run --------------------------------

test('gate: no node on PATH fails CLOSED rather than reporting a partial clean', () => {
  const root = gateRepo({ 'a.md': 'clean prose\n' }, NO_FIXTURE);
  // A PATH with the shell utilities the script needs, but deliberately without node.
  const bin = join(root, 'fakebin');
  mkdirSync(bin, { recursive: true });
  for (const tool of ['git', 'grep', 'xargs', 'printf', 'sed', 'uname', 'dirname']) {
    const r = spawnSync('which', [tool], { encoding: 'utf8' });
    if (r.status === 0) { try { symlinkSync(r.stdout.trim(), join(bin, tool)); } catch { /* dup */ } }
  }
  const { code, out } = runGate(root, [], { PATH: bin });
  assert.equal(code, 1, out);
  assert.match(out, /node not found — Layer 2 did NOT run/);
  assert.doesNotMatch(out, /sanitize scan clean/);
  rmSync(root, { recursive: true, force: true });
});

// --- arguments narrow BOTH layers, and the summary says so --------------------

test('gate: a path argument narrows Layer 1 too, and the clean bill is labelled partial', () => {
  const root = gateRepo({
    'README.md': '# readme\n',
    'leak.md': `${SHAPES.tailnet}\n`,                  // Layer 1
    'leak2.md': 'Hire Dorian at AcmeOrg/registry\n',   // Layer 2  // sanitize:allow
  }, NO_FIXTURE);
  assert.equal(runGate(root).code, 1, 'the whole tree must fail');

  const partial = runGate(root, ['README.md']);
  assert.equal(partial.code, 0);
  // The regression: this used to print an unqualified "✓ sanitize scan clean".
  assert.match(partial.out, /NOT a whole-tree clean bill/);

  // And a path argument reaches Layer 1, which previously ignored "$@" entirely.
  assert.equal(runGate(root, ['leak.md']).code, 1);
  assert.equal(runGate(root, ['leak2.md']).code, 1);
  rmSync(root, { recursive: true, force: true });
});

test('gate: --substrate narrows Layer 2 only, and says so', () => {
  const root = gateRepo({
    'garden/notes.md': 'Hire Dorian at AcmeOrg/registry\n',  // sanitize:allow
  }, { instance_paths: ['garden/', '.overlay/'], expect_findings: [] });
  assert.equal(runGate(root).code, 1, 'the default whole-tree scope covers garden/');

  const sub = runGate(root, ['--substrate']);
  assert.equal(sub.code, 0);
  assert.match(sub.out, /narrowed to --substrate/);

  // Layer 1 is NOT narrowed by --substrate: a credential shape in the instance set
  // still fails, because scanning more can only ever be a false red.
  const withKey = gateRepo({ 'garden/notes.md': `${SHAPES.tailnet}\n` },
    { instance_paths: ['garden/'], expect_findings: [] });
  assert.equal(runGate(withKey, ['--substrate']).code, 1);
  rmSync(withKey, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

// --- the mutation the old suite could not see ---------------------------------

test('gate: a gutted gate fails this suite', () => {
  // Direct answer to "the script could be replaced by an echo and nothing would notice".
  const root = gateRepo({ 'a.md': 'Hire Dorian at AcmeOrg/registry\n' }, NO_FIXTURE);  // sanitize:allow
  writeFileSync(join(root, 'tools/sanitize-scan.sh'), 'echo "✓ sanitize scan clean"\nexit 0\n');
  const { code } = runGate(root);
  assert.equal(code, 0, 'sanity: the gutted gate does report clean');
  // …which is exactly why every other case above asserts on a NON-zero exit for content
  // the gate must catch. A gutted gate cannot satisfy them.
  rmSync(root, { recursive: true, force: true });
});

// --- a file the gate cannot NAME is a file the gate cannot CLEAR ---------------
//
// The defect these pin: the tracked file list reached grep through a bare `xargs` and
// reached Layer 2 through `split('\n')`. Both mangle perfectly legal paths, in different
// ways and both silently:
//   * `xargs` splits on whitespace, so `my notes.md` became `my` + `notes.md`;
//   * `git ls-files` C-quotes non-ASCII paths, so `résumé.md` became the literal
//     `"r\303\251sum\303\251.md"`.
// Neither resulting path exists. Layer 1's error went to 2>/dev/null; Layer 2's statSync
// threw into a bare `catch { continue }`. The file was dropped from the scan and the gate
// still printed a clean bill — the same shape of failure as the private-key pattern that
// never matched and the sanitize gate nothing invoked.

const SPACED = 'my notes.md';
const NONASCII = 'résumé.md';

test('gate: a filename with a SPACE is scanned by Layer 1, not split into two non-files', () => {
  const root = gateRepo({ [SPACED]: `${SHAPES.tailnet}\n` }, NO_FIXTURE);
  const { code, out } = runGate(root);
  assert.equal(code, 1, `a space in a filename must not exempt it\n${out}`);
  assert.match(out, /SANITIZE FAIL \[tailnet\]/);
  rmSync(root, { recursive: true, force: true });
});

test('gate: a C-quoted (non-ASCII) filename is scanned by BOTH layers', () => {
  // Layer 1: `git ls-files -z` hands grep the raw path.
  const l1 = gateRepo({ [NONASCII]: `${SHAPES.privatekey}\n` }, NO_FIXTURE);
  const r1 = runGate(l1);
  assert.equal(r1.code, 1, `Layer 1 must reach a non-ASCII path\n${r1.out}`);
  assert.match(r1.out, /SANITIZE FAIL \[privatekey\]/);
  rmSync(l1, { recursive: true, force: true });

  // Layer 2: trackedFiles() splits on NUL, so statSync gets a path that exists.
  const l2 = gateRepo({ [NONASCII]: 'Hire Dorian at AcmeOrg/registry\n' }, NO_FIXTURE);  // sanitize:allow
  const r2 = runGate(l2);
  assert.equal(r2.code, 1, `Layer 2 must reach a non-ASCII path\n${r2.out}`);
  assert.match(r2.out, /SANITIZE FAIL \[particulars\]/);
  rmSync(l2, { recursive: true, force: true });
});

test('gate: a tree whose ONLY leaks are in awkward filenames does not report clean', () => {
  // The false green, end to end: before the fix this exact repo exited 0 with
  // "✓ sanitize scan clean" while carrying a PEM header, a tailnet host, a phone
  // number, a named person, an org namespace, a sum and an email address.
  const root = gateRepo({
    [SPACED]: `${SHAPES.tailnet}\n${SHAPES.privatekey}\n${SHAPES.phone}\n`,
    [NONASCII]: 'Hire Dorian at AcmeOrg/registry for $50,000 — dorian@acme.dev\n',  // sanitize:allow
  }, NO_FIXTURE);
  const { code, out } = runGate(root);
  assert.equal(code, 1, `the gate must not clear files it never opened\n${out}`);
  assert.doesNotMatch(out, /sanitize scan clean/);
  rmSync(root, { recursive: true, force: true });
});

test('gate: an explicit path argument with a space narrows to that one file', () => {
  // The array-of-paths change has to hold for argv too, not just for ls-files.
  const root = gateRepo({
    [SPACED]: `${SHAPES.tailnet}\n`,
    'clean.md': '# nothing here\n',
  }, NO_FIXTURE);
  const hit = runGate(root, [SPACED]);
  assert.equal(hit.code, 1, hit.out);
  assert.match(hit.out, /SANITIZE FAIL \[tailnet\]/);

  const miss = runGate(root, ['clean.md']);
  assert.equal(miss.code, 0, miss.out);
  assert.match(miss.out, /NOT a whole-tree clean bill/);
  rmSync(root, { recursive: true, force: true });
});

test('gate: Layer 1 still fires on a PATH carrying only what it greps with', () => {
  // Why the stderr split is done by prefix rather than through a temp file: a `mktemp`
  // in scan() is a dependency that, when missing, would silence Layer 1 entirely — the
  // same shape of quiet failure as everything else in this file. This pins that Layer 1
  // needs nothing beyond git/grep/xargs to work.
  const root = gateRepo({ 'a.md': `${SHAPES.tailnet}\n` }, NO_FIXTURE);
  const bin = join(root, 'fakebin');
  mkdirSync(bin, { recursive: true });
  for (const tool of ['git', 'grep', 'xargs', 'sed', 'printf', 'dirname', 'uname']) {
    const r = spawnSync('which', [tool], { encoding: 'utf8' });
    if (r.status === 0) { try { symlinkSync(r.stdout.trim(), join(bin, tool)); } catch { /* dup */ } }
  }
  const { code, out } = runGate(root, [], { PATH: bin });
  assert.equal(code, 1, out);
  assert.match(out, /SANITIZE FAIL \[tailnet\]/, 'Layer 1 must not depend on mktemp');
  rmSync(root, { recursive: true, force: true });
});

test('gate: a scan that errors fails CLOSED instead of discarding the error', () => {
  // Layer 1 used to send grep's stderr to /dev/null, which is how every bug this
  // function has had stayed invisible. Point it at a tracked path that is not there.
  const root = gateRepo({ 'a.md': '# clean\n' }, NO_FIXTURE);
  execFileSync('git', ['-C', root, 'add', '-N', '.']);
  rmSync(join(root, 'a.md'));            // tracked in the index, absent from the worktree
  const { code, out } = runGate(root);
  assert.equal(code, 1, `an unreadable tracked file is not a clean file\n${out}`);
  assert.match(out, /the scan itself errored|SANITIZE FAIL \[unreadable\]/);
  assert.doesNotMatch(out, /✓ sanitize scan clean/);
  rmSync(root, { recursive: true, force: true });
});
