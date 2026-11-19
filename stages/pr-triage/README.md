# PR triage — a gardener stage

Gives every open pull request in your watched repos one verdict, and turns anything
that needs a person into a draft decision. Run it once per cycle, before the gardener
reasons about the board.

```bash
PR_TRIAGE_REPOS="your-org/app your-org/lib" bash stages/pr-triage/pr-triage.sh
```

Or list the repos, one per line, in `.overlay/pr-triage.repos` (instance-owned, never
shipped).

## What you get

A markdown block: a table (CI, how far behind base, conflicts, author, verdict), a
notes list, the actions taken or proposed, draft decisions in the `SPEC.md`
`decisions.md` format, and one `pr-triage:` summary line.

| Verdict | Means |
|---|---|
| `MERGE (<severity> security fix, vetted)` | a Dependabot or Renovate bump your operator allows to merge unasked; one per repo per run |
| `MERGE AFTER <x>` | mergeable once `<x>` happens (rebase, CI, approval, review) |
| `CLOSE AS SUPERSEDED` | its changes are already on the base, checked by content |
| `NEEDS OWNER (@login) — <why>` | draft, red CI, or conflicts on a person's PR |
| `NEEDS FIX — <why>` | red CI or supply-chain flags on a bot bump |
| `STALE (park)` | no update in 30 days |

## The rules it keeps

- **Never merges, closes, or comments on a person's PR.** Those become draft decisions.
  Its one write is `@dependabot rebase` on a behind or conflicting Dependabot PR, and
  only with `--apply-rebase`, at most once per PR per 24 hours.
- **Content, not ancestry.** A squash merge leaves a branch's commits looking unmerged
  forever. Supersession compares each changed file's blob on the PR head with the base.
- **Security fix** means a GitHub advisory affects the old version and not the new one.
- **Supply chain (npm):** the new version is at least 3 days old, has the same
  publisher, adds no install scripts, keeps provenance, and has no advisory of its own.
  The PR touches only manifests, lockfiles, or workflows. Other ecosystems report
  `unknown` and never merge unasked.
- **Never past a red or pending check.** A major-version jump is flagged for a
  post-merge smoke test.
- **Unasked merges are opt-in.** `PR_TRIAGE_UNASKED_SEVERITIES` (default `critical`;
  set it empty for none) names the severities that may merge without a decision, and
  only when every check passed *and* the model read passed. With no model configured,
  nothing merges unasked. Whether your gardener may act on that row at all is your
  `AUTONOMY.md` grant.

## The model read (optional)

Set `PR_TRIAGE_LLM_CMD` to an executable that takes a prompt as its one argument and
prints the reply; run it with no tools and a fresh context. The script gathers every
fact itself; the model only judges. The diff is fenced as untrusted data. The verdict
line (`SUPPLY_VERDICT=` or `SUPERSEDED=`) must appear exactly once at the start of a
line: zero lines, two lines, or a decorated value all count as "no". Each call has a
watchdog, the calls per run are capped, and the PR order rotates by date so the cap
reaches every PR in turn.

## Tests

`bash stages/pr-triage/pr-triage.test.sh` (also run by `npm test`). The suite fakes
`gh`, the registry and the model, and puts tripwire `gh`, `curl` and `claude` on `PATH`,
so a test that would reach a real service fails instead of passing.

Configuration is listed at the top of `pr-triage.sh`.
