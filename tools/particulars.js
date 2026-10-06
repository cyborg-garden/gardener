// tools/particulars.js — Layer 2 of the sanitize gate: org/person/narrative particulars.
//
// Layer 1 (tools/sanitize-scan.sh) catches credential- and machine-shaped strings:
// home paths, tailnet hostnames, PEM headers, UUIDs, phone numbers. It cannot catch the
// class DISTRIBUTION.md calls Layer 2 — "operator and engagement *particulars* — real
// names, client names, internal codenames — individually innocuous but collectively
// identifying of a private context". This file is that layer, in code.
//
// Two sources of signal, both DETERMINISTIC and both offline:
//
//   1. DECLARED — terms the operator writes in `.overlay/particulars` (one per line;
//      `re:` prefix for a regex). The overlay is the instance region: gitignored, never
//      contributed, never shipped upstream. This is how a fork declares *its own*
//      particulars without the substrate ever learning them. Nothing org-specific is
//      hardcoded here — a shipped default naming one org would itself be a particular
//      leaking into a public artefact.
//
//   2. STRUCTURAL — shapes that identify a private context regardless of whose context
//      it is, so they need no configuration and work in a stranger's fork on day one:
//      org/repo namespaces, person names in person-relations, engagement money talk,
//      and email addresses.
//
// The structural rules are heuristics: they will occasionally flag something generic.
// A finding is a stop-and-look, not a verdict. Two suppressions exist, both narrow and
// both visible in a diff: an inline `sanitize:allow` marker clears the ONE line a human
// put it on — up to a length budget, see `marker_max_line` — and an `allow_substrings`
// entry clears only the matches it OVERLAPS. There is deliberately no directory-wide
// skip — see DEFAULT_CONFIG.
//
// Be honest about what the marker is: a HUMAN-TYPED ESCAPE HATCH. Anyone who can edit a
// file can type it, and nothing here distinguishes a reviewed suppression from a
// convenient one. It defends against ACCIDENT, not against INTENT. The scoping rules
// exist to stop an honest suppression from reaching further than its author realised,
// and to put every suppression in the diff where a second human sees it. Review is the
// control; this file is the reminder. See DISTRIBUTION.md § The sanitize gate.
//
// An optional semantic (LLM) lane exists below. It is OPT-IN, it degrades silently to
// "not run" when no command is configured or the command fails, and it is NEVER the only
// thing standing between a particular and the public: the deterministic rules above carry
// the weight of this gate, and this file must stay useful with no model in reach.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

export const CONFIG_FILE = 'sanitize.particulars.json';

export const DEFAULT_CONFIG = {
  // NOTE: there is deliberately no `skip_paths`. A directory-wide skip is an
  // unconditional escape hatch over a directory that ships in the public artefact —
  // anything dropped inside it passes green, including the particulars this layer
  // exists to catch. The two narrow mechanisms below replace it:
  //   * `inline_marker` — a PER-LINE, human-placed, diff-visible suppression;
  //   * `expect_findings` — an INVERTED fixture file, which must be flagged. Its
  //     findings do not fail the gate; its *silence* does.
  // Both are scoped to something a reviewer can see. A directory skip is not.
  //
  // The instance set from DISTRIBUTION.md. `--substrate` scope excludes these; the
  // default whole-tree scope does not (a public artefact's example garden must be as
  // clean as its machinery).
  instance_paths: ['garden/', '.overlay/'],
  // The inline, per-line suppression marker. Put it in a comment on the line and that
  // line is cleared. It shows up in the diff, so a reviewer sees every suppression —
  // that is the whole safeguard. This file uses it on the rule definitions themselves,
  // which necessarily contain the vocabulary they hunt for.
  inline_marker: 'sanitize:allow',
  // The budget that keeps "clears the line" from meaning "clears the file".
  //
  // The marker's entire warrant is that a reviewer can SEE what it covers in the diff.
  // That warrant holds for a source line and collapses for a line that is an entire
  // file: `text.split('\n')` on a newline-free file — minified JS, a one-line JSON
  // blob, anything written without a trailing newline — yields exactly one "line", so
  // a single marker anywhere in it silenced every rule over the whole file. Removing
  // the directory-wide skip is what exposed this: it left the marker as the only
  // suppression wide enough to be worth abusing.
  //
  // Above this many characters the marker is REFUSED and the line is scanned normally.
  // Findings on a refused line say so, so the refusal is never a silent surprise; a
  // refused marker on a line that had nothing to suppress stays quiet, because a
  // suppression that suppresses nothing is not worth an alarm.
  //
  // 300 is roughly three soft-wrapped terminal lines — the outer edge of what anyone
  // actually reads in a diff hunk, and orders of magnitude below any minified bundle.
  // In this repo the longest marker line that suppresses anything is 179 characters.
  //
  // Two alternatives were considered and rejected:
  //   * a WINDOW around the marker (clear only matches within ±N chars). More precise
  //     in principle, but a suppression you cannot predict by eye is worse than one you
  //     can — a trailing marker on a long line would clear its neighbours and not the
  //     match at the start, which no reviewer would guess from reading it.
  //   * a CAP on markers per file, to stop someone rebuilding the directory skip by
  //     spamming them. Redundant: every marker costs its own line, and two hundred
  //     marker lines in a diff is the loudest signal this mechanism can produce.
  marker_max_line: 300,
  // Exact substrings that clear a MATCH THEY OVERLAP — not the whole line. `example.com`
  // must silence the email rule on `user@example.com`; it must NOT silence a declared
  // particular sitting elsewhere on the same line. A whole-line allowlist is a kill
  // switch wearing a per-rule label, and the strongest signal this layer has (the
  // operator-declared lane) is exactly what it would silence.
  allow_substrings: ['example.com', 'user@example', 'noreply@anthropic.com'],
  // Inverted fixtures: EXACT repo-relative file paths (no prefixes, no directories —
  // a prefix would rebuild the escape hatch) whose findings are expected. A listed file
  // that produces no findings, or that does not exist, FAILS the gate.
  expect_findings: [],
  // Inline declared particulars, for operators who prefer config over the overlay file.
  declared: [],
  declared_file: '.overlay/particulars',
  rules: { 'org-repo': true, 'person-name': true, 'money': true, 'email': true },
  // Opt-in semantic lane. `["some","argv"]` — see runSemantic below. null = not run.
  semantic: { command: null },
};

// ---------------------------------------------------------------- config

export function loadConfig(root = '.') {
  let file = {};
  const p = join(root, CONFIG_FILE);
  if (existsSync(p)) {
    try { file = JSON.parse(readFileSync(p, 'utf8')); } catch { file = {}; }
  }
  const cfg = { ...DEFAULT_CONFIG, ...file };
  cfg.rules = { ...DEFAULT_CONFIG.rules, ...(file.rules || {}) };
  cfg.semantic = { ...DEFAULT_CONFIG.semantic, ...(file.semantic || {}) };
  cfg.declared = [...(cfg.declared || []), ...loadDeclared(root, cfg.declared_file)];
  return cfg;
}

// Parse the operator-owned declaration file: one term per line, `#` comments, blanks
// ignored, `re:` prefix for a regular expression.
export function loadDeclared(root = '.', file = DEFAULT_CONFIG.declared_file) {
  const p = join(root, file);
  if (!file || !existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

// ---------------------------------------------------------------- rules

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Capitalized words that are not people. Generic English openers plus this substrate's
// own vocabulary — a fork inherits it unchanged.
const NOT_A_NAME = new Set([
  'The', 'This', 'That', 'These', 'Those', 'There', 'They', 'Then', 'Their', 'It', 'Its',
  'We', 'You', 'Your', 'She', 'Her', 'His', 'Who', 'What', 'When', 'Where', 'While',
  'Which', 'And', 'But', 'For', 'Not', 'Nothing', 'Everything', 'Someone', 'Anyone',
  'Each', 'Every', 'Any', 'All', 'Some', 'One', 'Two', 'Both', 'Now', 'Next', 'Later',
  'Done', 'Held', 'Note', 'Warning', 'Layer', 'Status', 'Verdict', 'Context', 'Decision',
  'Handoff', 'Board', 'Garden', 'Gardener', 'Agent', 'Human', 'Operator', 'Maintainer',
  'Everyone', 'Nobody', 'Anybody', 'Somebody', 'Because', 'Before', 'After', 'Once',
]);

// A person named in a person-relation: hired, paid, thanked, or the subject of an
// intent verb. Group 1 is the candidate name.
const PERSON_VERBS = [
  'hire', 'hires', 'hiring', 'hired', 'onboard', 'onboarding', 'onboarded', 'pay',
  'paying', 'paid', 'thank', 'thanks', 'thanked', 'assign', 'assigned to', 'reviewer:',
  'owner:', 'contact:', 'met with', 'call with', 'introduce', 'introduced',
];
const INTENT_VERBS = [
  'wants', 'wanted', 'said', 'says', 'asked', 'prefers', 'preferred', 'decided',
  'decides', 'confirms', 'confirmed', 'signals', 'signalled', 'signaled', 'approved',
  'approves', 'agreed', 'owns', 'is being', 'was being', 'will be',
];
// Accept a capitalized verb too (a board line can open with "Hire …"), without making
// the whole pattern case-insensitive — that would let the name group match any lowercase
// word. The lookbehind stops a hyphenated slug (`#someone-hire Hire …`) from being read
// as the verb, which would consume the capitalized verb as the name and hide the real
// one sitting right behind it.
const anyCase = w => w.replace(/^([a-z])/, (_, c) => `[${c.toUpperCase()}${c}]`).replace(/ /g, '\\s+');
const PERSON_PATTERNS = [
  new RegExp(`(?<![-\\w])(?:${PERSON_VERBS.map(anyCase).join('|')})\\s+@?([A-Z][a-z]{2,})\\b`, 'gd'),
  new RegExp(`\\b([A-Z][a-z]{2,})(?:'s)?\\s+(?:${INTENT_VERBS.join('|')})\\b`, 'gd'),
  // A named person tied to being paid or engaged — the collectively-identifying case
  // this layer exists for: who, plus what they are owed, plus when.
  /\b([A-Z][a-z]{2,})\s+(?:gets?|got|is|was|will\s+be)\s+(?:paid|invoiced|hired|onboarded)\b/gd,  // sanitize:allow
];

// Money attached to an engagement or a person's circumstances. Amounts are structural;
// the phrase list is generic English, not anyone's vocabulary.
const MONEY_PATTERNS = [
  // A currency amount, not a shell positional or a regex backreference: two or more
  // digits, a decimal, or a k/m suffix. `$5` alone is deliberately below the bar —
  // `$1` in a script is far more common than a one-digit sum in prose.
  /[$£€¥]\s?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d{2,}|\d\s?[kKmM]\b)/gd,
  /\b(?:gets?|got|getting)\s+paid\b/gid,
  /\b(?:company\s+exit|funding|funded\s+by|runway|burn\s+rate|invoice[sd]?|salary|day\s+rate|retainer|valuation|cap\s+table|payout|equity\s+grant|ARR|MRR)\b/gd,  // sanitize:allow
];

const ORG_REPO = /\b[A-Z][A-Za-z0-9]{2,}\/[A-Za-z][A-Za-z0-9._-]{2,}\b/gd;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gd;

const WHY = {
  'declared': 'declared particular for this instance',
  'org-repo': 'org/repo namespace — names a specific organisation',
  'person-name': 'a named person in a person-relation',
  'money': 'money or funding tied to an engagement',  // sanitize:allow
  'email': 'an email address identifies a real person',
};

function declaredPatterns(declared) {
  return (declared || []).map(t => {
    if (t.startsWith('re:')) {
      try { return new RegExp(t.slice(3), 'gid'); } catch { return null; }
    }
    return new RegExp(`\\b${esc(t)}\\b`, 'gid');
  }).filter(Boolean);
}

// Returns [{ text, start, end }] — the span is what the allowlist is scoped against, so
// a suppression can reach the match it is meant for and nothing else on the line.
function collect(line, re) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    // Group 1 is the candidate (a person's name inside a verb phrase); when there is no
    // group the whole match is the candidate. `d` gives us the group's own span.
    const useGroup = m[1] !== undefined;
    const span = (m.indices && (useGroup ? m.indices[1] : m.indices[0])) || [m.index, m.index + m[0].length];
    out.push({ text: useGroup ? m[1] : m[0], start: span[0], end: span[1] });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

// Every span on `line` covered by an allow substring. Suppression is by OVERLAP, not
// containment: `example.com` must clear the email match `user@example.com`, which is
// wider than the allow substring itself.
function allowSpans(line, allow) {
  const spans = [];
  for (const a of allow || []) {
    if (!a) continue;
    let i = line.indexOf(a);
    while (i !== -1) {
      spans.push([i, i + a.length]);
      i = line.indexOf(a, i + 1);
    }
  }
  return spans;
}

const overlapsAllowed = (m, spans) => spans.some(([s, e]) => m.start < e && m.end > s);

/**
 * Scan text for particulars. Returns [{ rule, line, match, why }] — line is 1-indexed.
 * Pure: no fs, no network, no process state.
 */
export function scanText(text, cfg = DEFAULT_CONFIG) {
  const rules = { ...DEFAULT_CONFIG.rules, ...(cfg.rules || {}) };
  const allow = cfg.allow_substrings || [];
  const marker = cfg.inline_marker === undefined ? DEFAULT_CONFIG.inline_marker : cfg.inline_marker;
  const maxLine = Number.isInteger(cfg.marker_max_line) && cfg.marker_max_line >= 0
    ? cfg.marker_max_line
    : DEFAULT_CONFIG.marker_max_line;
  const declared = declaredPatterns(cfg.declared);
  const findings = [];
  const seen = new Set();

  text.split('\n').forEach((line, i) => {
    // The INLINE MARKER is the only whole-line suppression, and it is the one a human
    // typed onto that line on purpose. `allow_substrings` are span-scoped below: a
    // substring that merely appears on a line must not silence every other rule on it —
    // least of all the operator-declared lane, which is the strongest signal here.
    //
    // "The line it is on" is only a narrow scope while a line is a line. On a file with
    // no newlines there is exactly ONE line — the whole file — and the marker became a
    // file-wide kill switch. Over the budget it is refused; see `marker_max_line`.
    const marked = Boolean(marker) && line.includes(marker);
    const refused = marked && line.length > maxLine;
    if (marked && !refused) return;
    const n = i + 1;
    const note = refused
      ? ` (an inline \`${marker}\` on this line was REFUSED: the line is ${line.length}` +
        ` chars, over the ${maxLine}-char budget — a marker cannot clear a line no` +
        ` reviewer can read. Split the line, or remove the particular.)`
      : '';
    const spans = allowSpans(line, allow);
    const push = (rule, m) => {                      // one finding per rule/line/match
      if (overlapsAllowed(m, spans)) return;
      const key = `${rule}|${n}|${m.text}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push({ rule, line: n, match: m.text, why: WHY[rule] + note });
    };

    for (const re of declared) for (const m of collect(line, re)) push('declared', m);
    if (rules['org-repo']) for (const m of collect(line, ORG_REPO)) push('org-repo', m);
    if (rules['person-name']) {
      for (const re of PERSON_PATTERNS) {
        for (const m of collect(line, re)) if (!NOT_A_NAME.has(m.text)) push('person-name', m);
      }
    }
    if (rules['money']) {
      for (const re of MONEY_PATTERNS) for (const m of collect(line, re)) push('money', m);
    }
    if (rules['email']) for (const m of collect(line, EMAIL)) push('email', m);
  });
  return findings;
}

// ---------------------------------------------------------------- files

// Every tracked file is in scope. The only prefix-based exclusion left is `--substrate`,
// which is a narrowing a human asks for explicitly on the command line (and which the
// gate now names in its summary), not a standing hole in the default scan.
export function inScope(rel, cfg, scope = 'tree') {
  if (scope === 'substrate' && (cfg.instance_paths || []).some(p => rel.startsWith(p))) return false;
  return true;
}

// An inverted fixture: a file that MUST produce findings. Matching is by EXACT path —
// a prefix match would rebuild the directory-wide escape hatch this replaced.
export function isExpectFindings(rel, cfg) {
  return (cfg.expect_findings || []).includes(rel);
}

/**
 * Split a scan into the findings that fail the gate and the inversion's own verdict.
 * `scanned` is the list of paths that were actually read.
 *
 * The inversion is what lets a fixture hold particular-SHAPED content without carving a
 * blind spot: its findings do not fail the gate, but its SILENCE does. If someone
 * launders a real particular through the fixture they gain nothing (it is still not
 * secret — the file is read, and a human reviews it in the diff); if someone guts the
 * rules, the fixture goes quiet and the gate goes red.
 */
export function partition(findings, scanned, cfg) {
  const failing = findings.filter(f => !isExpectFindings(f.file, cfg));
  const flagged = new Set(findings.filter(f => isExpectFindings(f.file, cfg)).map(f => f.file));
  const scannedSet = new Set(scanned);
  const silent = [];
  for (const p of cfg.expect_findings || []) {
    if (!scannedSet.has(p)) silent.push({ file: p, reason: 'listed in expect_findings but not present in the scan' });
    else if (!flagged.has(p)) silent.push({ file: p, reason: 'listed in expect_findings but produced NO findings — the rules it exercises have gone quiet' });
  }
  return { failing, silent };
}

// `-z` is load-bearing, not a tidy-up. Plain `git ls-files` C-QUOTES any path holding a
// non-ASCII or control character: a tracked `résumé.md` comes back as the 18 characters
// `"r\303\251sum\303\251.md"`, quotes included. Split that on newlines and you have a path
// that does not exist, `statSync` throws, and the old `catch { continue }` below dropped
// the file from the scan without a word — so a particular in a non-ASCII filename passed
// the gate green. `-z` emits raw, unquoted paths delimited by NUL, which is the only form
// that round-trips every legal path.
export function trackedFiles(root = '.') {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

/**
 * Scan a list of repo-relative paths.
 * Returns { findings: [{ file, ...finding }], scanned: [rel], unreadable: [{file, reason}] }.
 *
 * `scanned` is what was actually read — what the expect_findings inversion is checked
 * against. `unreadable` is what this function was POINTED AT and could not open; the
 * caller must fail closed on it. A silent `continue` here is how the quoting bug above
 * stayed invisible: the gate cannot clear a file it never read, and the honest report of
 * that is a red gate naming the file, not a green one omitting it.
 */
export function scanTree(root, files, cfg = DEFAULT_CONFIG, scope = 'tree') {
  const findings = [];
  const scanned = [];
  const unreadable = [];
  for (const rel of files) {
    if (!inScope(rel, cfg, scope)) continue;
    const p = join(root, rel);
    let text;
    try {
      // A directory is a benign skip, not a withheld file: `git ls-files` lists submodules
      // as gitlink entries, and an explicit path argument may name a directory. Neither is
      // a file whose contents were kept from the scan.
      if (!statSync(p).isFile()) continue;
      text = readFileSync(p, 'utf8');
    } catch (e) {
      unreadable.push({ file: rel, reason: e.code || e.message });
      continue;
    }
    if (text.includes(String.fromCharCode(0))) continue;   // binary
    scanned.push(rel);
    for (const f of scanText(text, cfg)) findings.push({ file: rel, ...f });
  }
  return { findings, scanned, unreadable };
}

/** Findings only. */
export function scanFiles(root, files, cfg = DEFAULT_CONFIG, scope = 'tree') {
  return scanTree(root, files, cfg, scope).findings;
}

// ---------------------------------------------------------------- semantic lane (opt-in)

// OPT-IN and ADVISORY-BY-CONSTRUCTION. Configure `semantic.command` as an argv array;
// each file's content is written to the command's stdin and the command is expected to
// print {"flagged": bool, "reasons": [...]} on stdout. Any absence or failure — no
// command configured, binary not on PATH, non-JSON output, timeout — returns
// { ran: false } and the scan carries on. That is deliberate: this lane must never be
// load-bearing. If it were, a missing model would turn the gate green on a leak.
export function runSemantic(root, files, cfg, scope = 'tree') {
  const cmd = cfg.semantic && cfg.semantic.command;
  if (!Array.isArray(cmd) || cmd.length === 0) return { ran: false, findings: [] };
  if (process.env.GARDEN_SANITIZE_SEMANTIC === 'off') return { ran: false, findings: [] };
  const findings = [];
  let ran = false;
  for (const rel of files) {
    if (!inScope(rel, cfg, scope)) continue;
    let text;
    try { text = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    try {
      const r = spawnSync(cmd[0], cmd.slice(1), { input: text, encoding: 'utf8', timeout: 120000 });
      if (r.error || r.status !== 0) continue;
      const s = r.stdout.indexOf('{'), e = r.stdout.lastIndexOf('}');
      if (s === -1 || e < s) continue;
      const verdict = JSON.parse(r.stdout.slice(s, e + 1));
      ran = true;
      if (verdict.flagged) {
        const reasons = Array.isArray(verdict.reasons) ? verdict.reasons : [String(verdict.reasons ?? '')];
        for (const why of reasons) findings.push({ file: rel, rule: 'semantic', line: 0, match: '', why });
      }
    } catch { /* silent by design — see the comment above */ }
  }
  return { ran, findings };
}

// ---------------------------------------------------------------- CLI

export function report(findings, out = console.error) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, fs_] of byFile) {
    out(`SANITIZE FAIL [particulars] ${file}:`);
    for (const f of fs_) out(`  ${file}:${f.line}: [${f.rule}] ${f.match || ''} — ${f.why}`);
  }
}

// CLI: `node tools/particulars.js [--full-tree|--substrate|<files...>]` — exit 1 on findings.
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const scope = argv.includes('--substrate') ? 'substrate' : 'tree';
  const args = argv.filter(a => !a.startsWith('--'));
  const root = '.';
  const cfg = loadConfig(root);
  const explicit = args.length > 0;
  const files = explicit ? args : trackedFiles(root);
  const { findings, scanned, unreadable } = scanTree(root, files, cfg, scope);
  const sem = runSemantic(root, files, cfg, scope);
  // The inversion is only meaningful over a whole-tree scan; a partial scan legitimately
  // will not have read the fixture, so do not manufacture a failure from it.
  const { failing, silent } = explicit
    ? { failing: findings, silent: [] }
    : partition(findings, scanned, cfg);
  const all = [...failing, ...sem.findings];
  if (all.length || silent.length || unreadable.length) {
    report(all);
    for (const s of silent) console.error(`SANITIZE FAIL [expect_findings] ${s.file}: ${s.reason}`);
    // Fail CLOSED on anything the scan was pointed at and could not open. An unscanned
    // file is not a clean file, and a gate must not average the two into a green.
    for (const u of unreadable) {
      console.error(`SANITIZE FAIL [unreadable] ${u.file}: could not be read (${u.reason}) — it was NOT scanned.`);
    }
    console.error(
      (all.length
        ? `\n✗ particulars layer: ${all.length} finding(s) — a private context is identifiable here.\n` +
          `  Remove them, or mark a reviewed line with \`${cfg.inline_marker}\` — which\n` +
          `  clears that ONE line, and only on lines of at most ${cfg.marker_max_line ?? DEFAULT_CONFIG.marker_max_line} characters.`
        : silent.length
          ? `\n✗ particulars layer: an inverted fixture stopped being flagged.`
          : `\n✗ particulars layer: ${unreadable.length} file(s) could not be read, so this is not a clean bill.`),
    );
    process.exit(1);
  }
  console.log(`✓ particulars layer clean (${scanned.length} files, scope=${explicit ? 'explicit paths' : scope}, semantic lane: ${sem.ran ? 'ran' : 'not run'})`);
}
