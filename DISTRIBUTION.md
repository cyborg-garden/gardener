# Distribution: staying in sync without losing what makes a gardener yours

The public gardener is a substrate you fork and customize. Two flows keep a fleet of
divergent gardeners coherent without either one clobbering the other:

- **update** (pull down): take improvements to the substrate from upstream without
  touching your customizations.
- **contribute** (push up): send a proven, *sanitized* improvement back to the
  substrate so every other gardener gets it.

The model is the way a mature framework fork stays current: a path-scoped selective
pull, plus a cross-fork PR that has passed a sanitize scan. The gardener is
**self-contained**, though. It implements its own `update`/`contribute` and depends on
no external framework, harness, or org. Borrow the technique, not the coupling.

> **Status:** this document is the contract. `garden-io` does not ship `update` or
> `contribute` yet. Until it does, follow these steps by hand. To pull down, do a
> selective checkout of substrate paths from a pinned upstream tag
> (`git fetch <upstream> <tag>` then `git checkout FETCH_HEAD -- <substrate paths>`).
> To push up, scope your diff to substrate paths, run `tools/sanitize-scan.sh`, and open
> a cross-fork PR. The scan covers the whole tracked tree of the checkout, so a clean
> result clears the tree, not just your diff. The path split and the sanitize gate are
> real today; the commands are the roadmap.

## The path split (the enabling idea)

Every file in a gardener install belongs to exactly one of two disjoint sets.

**Instance (you own):** your particulars.
`garden/` (your actual board, decisions, handoffs, knowledge), `.overlay/` (autonomy
grants, driver secrets, operator context), and anything gitignored.
`update` **never** touches these.

**Substrate (upstream owns):** everything else upstream ships, meaning the format and
the machinery (`SPEC.md`, `AUTONOMY.md`, this file, `RUBRIC.md`, `README.md`, `lib/`,
`bin/`, `tools/`, `test/`, `package.json`, …). `update` may overwrite these. The
instance set is the enumerated one and anything not in it is substrate, so every
tracked file falls in exactly one set by construction.

Because the sets are disjoint, pulling substrate updates is non-destructive *by
construction*: no file is written by both sides. The same discipline lets a framework
fork pull upstream without losing local config, because the customization surface and
the machinery surface never overlap.

## `garden-io update` (pull down)

1. Fetch the pinned upstream substrate (a tag, never a moving branch).
2. Check out **only substrate paths** into the working tree.
3. Leave `garden/`, `.overlay/`, and gitignored files exactly as they were.
4. Report what changed.

Your autonomy rung, your data, and your secrets are untouched. An update can never
silently raise or lower what your gardener may do (see `AUTONOMY.md`: grants live in the
overlay, which `update` does not write).

## `garden-io contribute` (push up)

1. Diff your local substrate changes against upstream, and **scope the diff to
   substrate paths only**, so instance files cannot be contributed even by accident.
2. Run the sanitize gate (below). **Refuse** on any finding.
3. Open a cross-fork PR to the public gardener with the sanitized diff.

## The sanitize gate

The one hard requirement of `contribute` is that nothing leaves an instance without
passing a two-layer scan.

**It runs on every push and pull request** (`.github/workflows/gate.yml`: `npm test`,
`npm run sanitize`, `npm run validate`). A scan that runs only when somebody remembers
to type it sits in no path, and every improvement made to it improves nothing that
actually runs. Run it by hand too (`npm run sanitize`), before a `contribute` and
before anything is made public. CI is the floor, not the ceiling.

- **Layer 1, credential and machine shapes (fail-closed):** the six greps in
  `tools/sanitize-scan.sh`. They catch home-directory paths, tailnet hostnames, PEM
  private-key headers, UUIDs, phone numbers, and one framework name. Each is covered by
  a test that puts its shape in a throwaway repo and asserts the gate exits non-zero
  (`test/sanitize-scan.test.js`). The tests matter because a pattern can fail without a
  sound: a pattern that starts with a dash, like the private-key header, is parsed by
  `grep` as options unless it is passed with `-e`, and the resulting error is easy to
  swallow. Layer 1 does **not** catch general hostnames or API-token shapes (`sk-…`,
  `ghp_…`). Extend the script before relying on it for those, and do not assume
  coverage the script doesn't have.

  **Every tracked path reaches both layers, and a path that doesn't turns the gate red.**
  The file list is NUL-delimited end to end (`git ls-files -z`, `xargs -0`, and a
  `split('\0')` in Layer 2). A newline-joined, whitespace-split list silently drops two
  entire classes of legal filename: anything containing a space (`xargs` splits it into
  two paths that do not exist) and anything non-ASCII (`git ls-files` C-quotes
  `résumé.md`, and the quoted form names no file). Both errors go to stderr, and if
  stderr is discarded, a tracked file with a space in its name can carry a private key
  past a gate that prints a clean bill. So a scan error is reported and fails the gate,
  and Layer 2 lists every file it could not open as `SANITIZE FAIL [unreadable]`. A file
  that was never read has not been cleared.
- **Layer 2, particulars (fail-closed):** operator and engagement *particulars*, such
  as real names, client names, and internal codenames. Each is innocuous alone, but
  together they identify a private context. Implemented in `tools/particulars.js`, run
  by `sanitize-scan.sh` as part of the same gate, from two sources:
  - **Declared:** terms you write in `.overlay/particulars`, one per line, `re:` prefix
    for a regex. The overlay is instance-owned and gitignored, so your org, your people
    and your codenames are known to *your* gate and never travel upstream. Upstream
    ships an empty declaration on purpose: a default naming one org would itself be a
    particular leaking into a public artefact.
  - **Structural:** shapes that identify a private context no matter whose it is, so
    they need no configuration and work in a fresh fork: org/repo namespaces, a named
    person in a person-relation (hired, paid, "X wants…"), engagement money and payment
    timing, and email addresses. These are heuristics. A finding means stop and look,
    not a verdict.

  **Suppressions are narrow on purpose, and every one of them is visible in a diff:**
  - `sanitize:allow` in a comment clears the **one line** a human put it on, and only if
    that line is at most `marker_max_line` characters (default **300**). This is the only
    whole-line suppression.

    The length budget is the difference between "clears the line" and "clears the file".
    A file with no newlines (minified JS, a one-line JSON blob, anything saved without a
    trailing newline) *is* a single line, so without a budget one marker at the head of
    it would silence every rule over every byte. Above the budget the marker is
    **refused**: the line is scanned normally and each finding on it says the marker was
    refused and why. A refused marker on a line with nothing to hide stays quiet, since a
    suppression that suppresses nothing does not need an alarm. Raise the budget in
    `sanitize.particulars.json` if you must; it is a visible, reviewable config change.

    In practice, on a short one-line file the marker still clears the whole file,
    because the whole file is one readable line sitting in front of the reviewer. The
    budget defends the case where nobody can read what is being cleared, not the case
    where the line simply is the file.
  - An `allow_substrings` entry clears only the matches whose **span it overlaps**.
    `example.com` silences the email rule on `user@example.com`; it does **not** silence a
    person, an org namespace, a sum, or a declared term elsewhere on the same line.
  - `expect_findings` lists **exact file paths** (never prefixes) that *must* be flagged,
    as inverted fixtures. Their findings do not fail the gate; their **silence** does.
    That is how `test/fixtures/particulars-expected.md` can carry particular-shaped
    content without becoming a blind spot: if a rule stops firing, the gate goes red.
  - There is **no directory skip**, and adding one would be a mistake. A directory-wide
    skip over a shipped directory means anything dropped inside it passes green.

  **What the inline marker is, plainly.** `sanitize:allow` is a human-typed escape hatch.
  Anyone who can edit a file can type it, and nothing in this gate can tell a reviewed
  suppression from a convenient one. **It defends against accident, not against intent.**
  Someone who *means* to move a particular into a public artefact can always add a marker
  next to it, and the gate will pass. The same is true of `allow_substrings` and of
  `expect_findings`. The scoping rules above (one line, bounded length, span-scoped
  substrings, exact fixture paths) exist to keep an *honest* suppression from being wider
  than its author realised, and to put every suppression in the diff where a second human
  can see it. Review is the control; the gate is the reminder. If your threat model
  includes a deliberate leaker with commit access, this gate is not it.

  Scope: the whole tracked tree by default, `garden/` **and** `test/` included, because
  a public artefact's example garden and its test suite are as public as its machinery.
  `--substrate` narrows Layer 2 to the substrate set for `contribute` (Layer 1 still
  covers the whole tree). Passing explicit paths narrows both layers, and the summary
  line then says so rather than issuing an unqualified clean bill.

- **Optional semantic lane (opt-in, never load-bearing):** set `semantic.command` in
  `sanitize.particulars.json` to an argv array; each file arrives on the command's
  stdin and it answers `{"flagged": bool, "reasons": [...]}`. With no command
  configured, or a command that is missing or fails, the lane silently does not run and
  the deterministic layers still gate. Never rely on this lane alone: a model that
  cannot be reached must never be the reason a leak passes.

A contribution is only as valuable as it is general. The gate strips the particular and
keeps the shape, so a pattern that helped one gardener can help all of them without
carrying the private context that produced it.

## Fleet shape

Instances need not share a network or filesystem; they meet only at the public repo. One
gardener pushes a sanitized pattern up, and every other one pulls it down on its next
`update`. The substrate is the single meeting point, divergence lives in the overlay, and
improvement flows through PRs. A gardener on your laptop and a gardener on a server on a
different network converge without ever touching each other directly.
