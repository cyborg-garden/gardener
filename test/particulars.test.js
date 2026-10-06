// test/particulars.test.js — Layer 2 of the sanitize gate.
//
// Every fixture below is SYNTHETIC. The point of this layer is that particulars do not
// belong in a public artefact, and a test suite is part of the artefact. The fixtures
// reproduce the *shape* of the content that got through, never the content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  DEFAULT_CONFIG, loadConfig, loadDeclared, scanText, scanFiles, scanTree, trackedFiles, inScope,
  isExpectFindings, partition, runSemantic,
} from '../tools/particulars.js';

function tempRoot(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'garden-particulars-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}
const rules = f => [...new Set(f.map(x => x.rule))].sort();
const matches = f => f.map(x => x.match);

// --- structural rules: no configuration, work in a stranger's fork ------------

test('org-repo: a GitHub-style org/repo namespace is a particular', () => {
  const f = scanText('see `AcmeOrg/artefact-registry` and `AcmeAI/package-template`');  // sanitize:allow
  assert.deepEqual(rules(f), ['org-repo']);
  assert.deepEqual(matches(f), ['AcmeOrg/artefact-registry', 'AcmeAI/package-template']);  // sanitize:allow
});

test('org-repo: lowercase paths and short acronyms are not org namespaces', () => {
  const f = scanText('read garden/handoffs/index.md over TCP/IP in CI/CD');
  assert.deepEqual(f, []);
});

test('person-name: a name in a person-relation is flagged, capitalized verb included', () => {
  assert.deepEqual(matches(scanText('Hire Dorian to co-design the thing')), ['Dorian']);  // sanitize:allow
  assert.deepEqual(matches(scanText('we hired Dorian last week')), ['Dorian']);  // sanitize:allow
  assert.deepEqual(matches(scanText('Robin wants the board reshuffled')), ['Robin']);  // sanitize:allow
  assert.deepEqual(matches(scanText("Robin's asked for a digest")), ['Robin']);  // sanitize:allow
});

test('person-name: a slug does not shadow the real name after it', () => {
  // `#dorian-hire Hire Dorian …` — the hyphenated slug must not be consumed as the verb,  // sanitize:allow
  // which would leave the actual name unflagged.
  const f = scanText('- [ ] (P2) #dorian-hire Hire Dorian to co-design a template');  // sanitize:allow
  assert.deepEqual(matches(f), ['Dorian']);
});

test('person-name: capitalized function words and substrate nouns are not people', () => {
  for (const line of [
    'The gardener wants a quiet default',
    'This is being enforced by lib/autonomy.js',
    'Every agent said the same thing',
    'Nothing will be written without a grant',
  ]) assert.deepEqual(scanText(line), [], line);
});

test('money: engagement money and funding timing are particulars', () => {  // sanitize:allow
  assert.deepEqual(rules(scanText('blocked until Robin gets paid from a company exit')),  // sanitize:allow
    ['money', 'person-name']);
  assert.deepEqual(matches(scanText('blocked on funding, external human design labour')),  // sanitize:allow
    ['funding']);  // sanitize:allow
  assert.deepEqual(matches(scanText('a $33.39 deposit and a 12-month runway')),  // sanitize:allow
    ['$33.39', 'runway']);  // sanitize:allow
});

test('money: shell positionals and backreferences are not sums', () => {
  assert.deepEqual(scanText('scan() { grep -n"$2" "$3"; }  # $1 is the label'), []);
});

test('email: an address is flagged unless a reviewed line is allowlisted', () => {
  assert.deepEqual(matches(scanText('write to dorian@acme.dev')), ['dorian@acme.dev']);  // sanitize:allow
  assert.deepEqual(scanText('write to user@example.com'), []); // default allow_substrings
});

test('a reviewed line clears with an inline sanitize:allow marker', () => {
  assert.deepEqual(rules(scanText('const AMOUNT = /salary|runway/;')), ['money']);  // sanitize:allow
  assert.deepEqual(scanText('const AMOUNT = /salary|runway/;  // sanitize:allow'), []);
  // The marker clears the line it is on, and only that line.
  const two = scanText('salary here  // sanitize:allow\nrunway there');
  assert.deepEqual(two.map(f => f.line), [2]);
});

// --- the inline marker is bounded, so "the line" cannot mean "the file" -------
//
// The regression this pins: the marker was an unconditional whole-line early return, and
// `text.split('\n')` on a file with NO newlines — minified JS, a one-line JSON blob,
// anything saved without a trailing newline — yields exactly one "line": the whole file.
// So a single `sanitize:allow` at the head of such a file silenced every rule over every
// byte of it. Removing the directory-wide skip is what made this worth reaching for; it
// left the marker as the only suppression wide enough to be worth abusing.
//
// The fix is a length budget (`marker_max_line`). The marker's whole safeguard is that a
// reviewer can SEE what it covers in a diff, and that stops being true long before a
// minified bundle. Over the budget the marker is refused and the line is scanned anyway.

// Built at runtime so no line of this test file is itself over the budget.
const MARKER = '/*sanitize:allow*/';
// Assembled from fragments for the same reason test/sanitize-scan.test.js assembles its
// Layer-1 shapes: no fragment is a particular on its own, so no line of this file needs
// suppressing to hold the fixture that proves suppression is bounded.
const PARTICULARS = ['Hire ', 'Dorian', ' at ', 'AcmeOrg', '/registry for ', '$5', '0,000'].join('');
const minified = (marker = MARKER) =>
  `${marker}!function(e){var t="${'a'.repeat(280)}";return t}(); // ${PARTICULARS}`;

test('a newline-free file is ONE line, and one marker must not clear all of it', () => {
  const blob = minified();
  assert.equal(blob.includes('\n'), false, 'the fixture must have no newlines at all');
  assert.ok(blob.length > DEFAULT_CONFIG.marker_max_line, 'and must exceed the budget');

  // Without the marker: four particulars, all on "line 1".
  const bare = rules(scanText(minified('')));
  assert.deepEqual(bare, ['money', 'org-repo', 'person-name']);

  // With it: the marker is refused, so the same particulars still surface.
  assert.deepEqual(rules(scanText(blob)), bare,
    'a marker on a 300+ char line must not silence the file it is the only line of');
});

test('a refused marker says so in the finding, rather than failing silently', () => {
  const f = scanText(minified());
  assert.ok(f.length > 0);
  for (const x of f) {
    assert.match(x.why, /REFUSED/, 'every finding on a refused line must explain the refusal');
    assert.match(x.why, new RegExp(`${DEFAULT_CONFIG.marker_max_line}-char budget`));
  }
});

test('the budget does not touch the marker at ordinary line lengths', () => {
  // At and under the budget the marker behaves exactly as before — this is the
  // mechanism the substrate itself relies on, on its own rule definitions.
  const pad = ' '.repeat(DEFAULT_CONFIG.marker_max_line - MARKER.length - PARTICULARS.length);
  const atBudget = `${PARTICULARS}${pad}${MARKER}`;
  assert.equal(atBudget.length, DEFAULT_CONFIG.marker_max_line);
  assert.deepEqual(scanText(atBudget), [], 'exactly at the budget still clears');

  const overByOne = `${PARTICULARS} ${pad}${MARKER}`;
  assert.equal(overByOne.length, DEFAULT_CONFIG.marker_max_line + 1);
  assert.ok(scanText(overByOne).length > 0, 'one character over is refused');
});

test('a refused marker on a line with nothing to hide stays quiet', () => {
  // A suppression that suppresses nothing needs no alarm — otherwise every long prose
  // line that merely mentions the marker (this repo\'s own config does) turns red.
  const harmless = `${'ordinary prose '.repeat(30)}${MARKER}`;
  assert.ok(harmless.length > DEFAULT_CONFIG.marker_max_line);
  assert.deepEqual(scanText(harmless), []);
});

test('the budget is configurable, and a nonsense value falls back to the default', () => {
  const blob = minified();
  // An operator who genuinely needs a longer line can raise it — visibly, in config.
  assert.deepEqual(scanText(blob, { ...DEFAULT_CONFIG, marker_max_line: 10000 }), []);
  // Anything that is not a non-negative integer is not a budget.
  for (const bad of [null, -1, 'lots', 1.5, undefined]) {
    assert.ok(scanText(blob, { ...DEFAULT_CONFIG, marker_max_line: bad }).length > 0,
      `marker_max_line=${String(bad)} must fall back to the default, not disable the budget`);
  }
});

// --- allow_substrings are scoped to the SPAN they overlap, not the line -------
//
// The regression this pins: `allow` was applied as a whole-line early return before any
// rule ran, so one innocuous substring anywhere on a line cleared person-name, org-repo,
// money, email AND the operator-declared lane at once — a per-rule allowlist behaving as
// a per-line kill switch, silencing the strongest signal the layer has.

test('an allow substring clears the match it overlaps and nothing else on the line', () => {
  const cfg = { ...DEFAULT_CONFIG, declared: ['AcmeCo', 'Dorian', 'PROJ-X'] };  // sanitize:allow
  // Without the innocuous trailer, three declared terms.
  assert.deepEqual(matches(scanText('AcmeCo + Dorian + PROJ-X', cfg)),  // sanitize:allow
    ['AcmeCo', 'Dorian', 'PROJ-X']);
  // With it, still three: `example.com` reaches only its own span.
  assert.deepEqual(matches(scanText('AcmeCo + Dorian + PROJ-X (docs: example.com)', cfg)),  // sanitize:allow
    ['AcmeCo', 'Dorian', 'PROJ-X']);
});

test('an allow substring still clears the wider match that contains it', () => {
  // `example.com` is narrower than the email match `user@example.com`; overlap, not
  // containment, is what makes the intended suppression work.
  assert.deepEqual(scanText('write to user@example.com'), []);
  assert.deepEqual(scanText('mail noreply@anthropic.com about it'), []);
});

test('an allow substring does not clear a structural rule elsewhere on the line', () => {
  const f = scanText('Hire Dorian at AcmeOrg/registry — docs at example.com, $50,000');  // sanitize:allow
  assert.deepEqual(rules(f), ['money', 'org-repo', 'person-name']);
  assert.ok(f.some(x => x.match === 'Dorian'), 'the person must survive the allowlist');  // sanitize:allow
  assert.ok(f.some(x => x.match === '$50,000'), 'the sum must survive the allowlist');  // sanitize:allow
});

test('a rule can be turned off without touching the others', () => {
  const cfg = { ...DEFAULT_CONFIG, rules: { ...DEFAULT_CONFIG.rules, money: false } };
  assert.deepEqual(rules(scanText('blocked on funding for AcmeOrg/registry', cfg)), ['org-repo']);  // sanitize:allow
});

test('clean substrate prose produces no findings', () => {
  const f = scanText([
    '# Handoff: example',
    'Repo scaffolded. `garden-io` library and CLI are live.',
    '- Pick up #seed-01: wire garden-io into the dashboard',
    'Default to markdown files in a git repo — no external services, works offline.',
  ].join('\n'));
  assert.deepEqual(f, []);
});

// --- declared particulars: the operator owns them, the substrate never sees them ---

test('declared terms come from the gitignored overlay, one per line, # comments ignored', () => {
  const root = tempRoot({ '.overlay/particulars': '# mine\nAcmeCo\n\nDorian\n' });
  assert.deepEqual(loadDeclared(root), ['AcmeCo', 'Dorian']);
  const cfg = loadConfig(root);
  const f = scanText('acmeco ships on Tuesday', cfg);       // case-insensitive
  assert.deepEqual(rules(f), ['declared']);
  rmSync(root, { recursive: true, force: true });
});

test('a declared term matches on a word boundary, not as a substring', () => {
  const cfg = { ...DEFAULT_CONFIG, declared: ['Acme'] };
  assert.deepEqual(matches(scanText('Acme ships', cfg)), ['Acme']);
  assert.deepEqual(scanText('Acmetastic ships', cfg), []);
});

test('a declared term may be a regex with the re: prefix', () => {
  const cfg = { ...DEFAULT_CONFIG, declared: ['re:proj-[0-9]{3}'] };
  assert.deepEqual(matches(scanText('see proj-417 for detail', cfg)), ['proj-417']);
});

test('the substrate ships no particulars of its own', () => {
  // A default that named one org would itself be the leak this layer exists to stop.
  assert.deepEqual(DEFAULT_CONFIG.declared, []);
  assert.equal(loadDeclared('.', '.overlay/does-not-exist').length, 0);
});

// --- the class that got through ----------------------------------------------

// The shape that got through once: an external hire, an org namespace, and funding  // sanitize:allow
// timing spread across a handoff, an index line and a board line. Named by shape only —
// the person is not this artefact's business, and a test title ships publicly too.
test('the class that got through — an external hire, an org namespace, funding timing — FAILS', () => {  // sanitize:allow
  const root = tempRoot({
    'garden/handoffs/2026-07/23-hire-dorian-design.md': [
      '# Handoff: Hire Dorian to co-design a design/typography template',  // sanitize:allow
      '',
      'Robin wants to bring Dorian in to co-design a template — a new capability in the',  // sanitize:allow
      'AcmeCo artefact ecosystem, sitting alongside `AcmeOrg/artefact-registry`.',  // sanitize:allow
      '',
      '**This task cannot start until Robin gets paid from a company exit, expected in',  // sanitize:allow
      "~weeks.** Dorian is being hired for this work — paid external human design labour.",  // sanitize:allow
    ].join('\n'),
    'garden/handoffs/index.md':
      '- 2026-07-23 · hire-dorian-design · Hire Dorian to co-design a template (blocked on funding)\n',  // sanitize:allow
    'garden/state/threads.md':
      '## Held\n- [ ] (P2) #dorian-hire Hire Dorian to co-design a template — blocked on funding\n',  // sanitize:allow
  });
  const files = [
    'garden/handoffs/2026-07/23-hire-dorian-design.md',
    'garden/handoffs/index.md',
    'garden/state/threads.md',
  ];
  const f = scanFiles(root, files, DEFAULT_CONFIG);

  assert.ok(f.length > 0, 'the gate must not report clean on this');
  assert.deepEqual(rules(f), ['money', 'org-repo', 'person-name']);
  // Every one of the three files the commit touched is caught — a scrub scoped to the
  // handoff alone would leave the particulars behind in the index and the board.
  for (const rel of files) {
    assert.ok(f.some(x => x.file === rel), `${rel} must be flagged`);
  }
  rmSync(root, { recursive: true, force: true });
});

// --- scope: no directory is exempt --------------------------------------------

test('tree scope scans the example garden; substrate scope excludes the instance set', () => {
  assert.equal(inScope('garden/state/threads.md', DEFAULT_CONFIG, 'tree'), true);
  assert.equal(inScope('garden/state/threads.md', DEFAULT_CONFIG, 'substrate'), false);
  assert.equal(inScope('.overlay/particulars', DEFAULT_CONFIG, 'substrate'), false);
  assert.equal(inScope('lib/autonomy.js', DEFAULT_CONFIG, 'substrate'), true);
});

test('there is no directory-wide skip: test/ is scanned like anything else', () => {
  // The regression this replaces: `skip_paths: ["test/"]` meant a real particular
  // dropped into a shipped directory passed the gate green.
  assert.equal(inScope('test/particulars.test.js', DEFAULT_CONFIG, 'tree'), true);
  assert.equal(inScope('test/anything-at-all.md', DEFAULT_CONFIG, 'tree'), true);
  assert.equal('skip_paths' in DEFAULT_CONFIG, false);
  const root = tempRoot({ 'test/leak.md': 'Hire Dorian at AcmeOrg/registry\n' });  // sanitize:allow
  assert.deepEqual(rules(scanFiles(root, ['test/leak.md'], DEFAULT_CONFIG)),
    ['org-repo', 'person-name']);
  rmSync(root, { recursive: true, force: true });
});

test('a config that tries to reinstate skip_paths gets no effect from it', () => {
  const cfg = { ...DEFAULT_CONFIG, skip_paths: ['test/'] };
  assert.equal(inScope('test/leak.md', cfg, 'tree'), true);
});

// --- the inversion: a fixture is watched, not exempted -------------------------

test('expect_findings suppresses a listed file\'s findings but fails on its silence', () => {
  const cfg = { ...DEFAULT_CONFIG, expect_findings: ['test/fixtures/f.md'] };
  const root = tempRoot({
    'test/fixtures/f.md': 'Hire Dorian at AcmeOrg/registry\n',  // sanitize:allow
    'garden/real.md': 'Hire Dorian at AcmeOrg/registry\n',      // sanitize:allow
  });
  const { findings, scanned } = scanTree(root, ['test/fixtures/f.md', 'garden/real.md'], cfg);
  const { failing, silent } = partition(findings, scanned, cfg);
  // The fixture's own findings do not fail the gate…
  assert.deepEqual([...new Set(failing.map(f => f.file))], ['garden/real.md']);
  // …and while it is still being flagged, the inversion is satisfied.
  assert.deepEqual(silent, []);
  rmSync(root, { recursive: true, force: true });
});

test('expect_findings fails CLOSED when the fixture goes quiet or disappears', () => {
  const cfg = { ...DEFAULT_CONFIG, expect_findings: ['test/fixtures/f.md'] };
  const quiet = tempRoot({ 'test/fixtures/f.md': 'nothing to see here\n' });
  const q = scanTree(quiet, ['test/fixtures/f.md'], cfg);
  assert.equal(partition(q.findings, q.scanned, cfg).silent.length, 1);
  assert.match(partition(q.findings, q.scanned, cfg).silent[0].reason, /NO findings/);
  // Deleting the fixture is not an escape either.
  const gone = scanTree(quiet, [], cfg);
  assert.match(partition(gone.findings, gone.scanned, cfg).silent[0].reason, /not present/);
  rmSync(quiet, { recursive: true, force: true });
});

test('expect_findings matches an exact path only — a prefix is not a directory hatch', () => {
  const cfg = { ...DEFAULT_CONFIG, expect_findings: ['test/fixtures'] };
  assert.equal(isExpectFindings('test/fixtures/f.md', cfg), false);
  assert.equal(isExpectFindings('test/fixtures', cfg), true);
});

test('the shipped inverted fixture is real, tracked, and still being flagged', () => {
  const cfg = loadConfig('.');
  assert.deepEqual(cfg.expect_findings, ['test/fixtures/particulars-expected.md']);
  const f = scanFiles('.', cfg.expect_findings, cfg);
  assert.deepEqual(rules(f), ['email', 'money', 'org-repo', 'person-name']);
});

test('scanFiles skips what it cannot read instead of throwing', () => {
  const root = tempRoot({});
  assert.deepEqual(scanFiles(root, ['nope.md', 'also/missing.md'], DEFAULT_CONFIG), []);
  rmSync(root, { recursive: true, force: true });
});

test('scanTree REPORTS what it could not read rather than dropping it silently', () => {
  // `scanFiles` above returns findings only, which is why the quoting bug could hide in
  // it: no findings and no file read look identical from there. scanTree names them, and
  // the CLI fails closed on the list — an unscanned file is not a clean file.
  const root = tempRoot({ 'real.md': '# clean\n' });
  const { scanned, unreadable } = scanTree(root, ['real.md', 'gone.md'], DEFAULT_CONFIG);
  assert.deepEqual(scanned, ['real.md']);
  assert.deepEqual(unreadable.map(u => u.file), ['gone.md']);
  assert.equal(unreadable[0].reason, 'ENOENT');
  rmSync(root, { recursive: true, force: true });
});

test('scanTree treats a directory as a benign skip, not an unreadable file', () => {
  // `git ls-files` lists a submodule as a gitlink, and an explicit argument may name a
  // directory. Neither withheld a file's contents from the scan, so neither is a failure.
  const root = tempRoot({ 'sub/inner.md': '# clean\n' });
  const { scanned, unreadable } = scanTree(root, ['sub'], DEFAULT_CONFIG);
  assert.deepEqual(scanned, []);
  assert.deepEqual(unreadable, []);
  rmSync(root, { recursive: true, force: true });
});

// --- the file list has to survive every legal path ----------------------------

test('trackedFiles returns RAW paths — git C-quotes non-ASCII names, -z does not', () => {
  // Plain `git ls-files` prints `"r\303\251sum\303\251.md"` — quotes and octal escapes,
  // 18 characters describing a 10-character name. Splitting that on newlines yields a
  // path that does not exist, and the scan dropped the file without a word.
  const root = tempRoot({ 'résumé.md': 'Hire Dorian at AcmeOrg/registry\n' });  // sanitize:allow
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'add', '-N', '.']);

  const files = trackedFiles(root);
  assert.deepEqual(files, ['résumé.md'], 'the path must come back raw, not C-quoted');
  assert.equal(files[0].includes('\\'), false, 'no octal escapes');
  assert.equal(files[0].startsWith('"'), false, 'no wrapping quotes');

  // …and being nameable is what makes it scannable.
  const { findings, scanned, unreadable } = scanTree(root, files, DEFAULT_CONFIG);
  assert.deepEqual(scanned, ['résumé.md']);
  assert.deepEqual(unreadable, []);
  assert.deepEqual(rules(findings), ['org-repo', 'person-name']);
  rmSync(root, { recursive: true, force: true });
});

test('trackedFiles keeps a path containing a space in one piece', () => {
  const root = tempRoot({ 'my notes.md': 'Hire Dorian at AcmeOrg/registry\n' });  // sanitize:allow
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'add', '-N', '.']);
  assert.deepEqual(trackedFiles(root), ['my notes.md']);
  assert.deepEqual(rules(scanFiles(root, trackedFiles(root), DEFAULT_CONFIG)),
    ['org-repo', 'person-name']);
  rmSync(root, { recursive: true, force: true });
});

// --- the semantic lane is opt-in and never load-bearing -----------------------

test('semantic lane: not configured → not run, silently', () => {
  const root = tempRoot({ 'a.md': 'Hire Dorian\n' });  // sanitize:allow
  assert.deepEqual(runSemantic(root, ['a.md'], DEFAULT_CONFIG), { ran: false, findings: [] });
  rmSync(root, { recursive: true, force: true });
});

test('semantic lane: a missing command degrades to "not run", it does not throw', () => {
  const root = tempRoot({ 'a.md': 'Hire Dorian\n' });  // sanitize:allow
  const cfg = { ...DEFAULT_CONFIG, semantic: { command: ['definitely-not-on-path-xyz'] } };
  let out;
  assert.doesNotThrow(() => { out = runSemantic(root, ['a.md'], cfg); });
  assert.deepEqual(out, { ran: false, findings: [] });
  // …and the deterministic layer still catches it on its own. That is the contract:
  // no model in reach must never mean a green gate on a particular.
  assert.deepEqual(rules(scanFiles(root, ['a.md'], DEFAULT_CONFIG)), ['person-name']);
  rmSync(root, { recursive: true, force: true });
});

test('semantic lane: a configured command contributes advisory findings', () => {
  const root = tempRoot({ 'a.md': 'anything\n' });
  const cfg = {
    ...DEFAULT_CONFIG,
    semantic: {
      command: [process.execPath, '-e',
        'process.stdout.write(JSON.stringify({flagged:true,reasons:["names a specific engagement"]}))'],
    },
  };
  const out = runSemantic(root, ['a.md'], cfg);
  assert.equal(out.ran, true);
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].rule, 'semantic');
  assert.match(out.findings[0].why, /specific engagement/);
  rmSync(root, { recursive: true, force: true });
});

test('semantic lane: GARDEN_SANITIZE_SEMANTIC=off disables a configured command', () => {
  const root = tempRoot({ 'a.md': 'anything\n' });
  const cfg = { ...DEFAULT_CONFIG, semantic: { command: [process.execPath, '-e', 'console.log("{}")'] } };
  const prev = process.env.GARDEN_SANITIZE_SEMANTIC;
  process.env.GARDEN_SANITIZE_SEMANTIC = 'off';
  try {
    assert.deepEqual(runSemantic(root, ['a.md'], cfg), { ran: false, findings: [] });
  } finally {
    if (prev === undefined) delete process.env.GARDEN_SANITIZE_SEMANTIC;
    else process.env.GARDEN_SANITIZE_SEMANTIC = prev;
    rmSync(root, { recursive: true, force: true });
  }
});

// --- the shipped tree stays clean ---------------------------------------------

test('the shipped example garden carries no particulars', () => {
  const files = readdirSync('garden', { recursive: true, withFileTypes: true })
    .filter(d => d.isFile())
    .map(d => join(d.parentPath ?? d.path, d.name));
  assert.ok(files.length > 0, 'expected to find the example garden');
  assert.deepEqual(scanFiles('.', files, loadConfig('.')), []);
});

test('the WHOLE tracked tree carries no particulars, not just garden/', () => {
  // Scoping this to garden/ would miss a particular landing in DISTRIBUTION.md, README.md,
  // tools/ — or in a test title, which is how a real person's name got into this PR once.
  const cfg = loadConfig('.');
  const { findings, scanned } = scanTree('.', trackedFiles('.'), cfg, 'tree');
  const { failing, silent } = partition(findings, scanned, cfg);
  assert.deepEqual(failing, []);
  assert.deepEqual(silent, []);
  assert.ok(scanned.length > 20, 'expected the whole tree, not a slice');
});
