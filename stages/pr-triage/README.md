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
| `MERGE AFTER <x>` | mergeable once `<x>` happens (rebase, CI, approval, review) |
| `CLOSE AS SUPERSEDED` | its changes are already on the base, checked by content |
| `NEEDS OWNER (@login) — <why>` | draft, red CI, or conflicts on a person's PR |
| `NEEDS FIX — <why>` | red CI or supply-chain flags on a bot bump |
| `STALE (park)` | no update in 30 days |
| `NOT TRIAGED` | the run's time budget ran out; the order rotates daily |
| `AUTO-MERGE CANDIDATE (<severity> security fix)` | only if you opted in (below): a bot bump that passed every gate |

## It proposes. Merging is off by default.

Out of the box this stage merges nothing and names no merge candidates. It never closes
or comments on a person's PR either; those become draft decisions. Its one possible write
is `@dependabot rebase` on a behind or conflicting Dependabot PR, only with
`--apply-rebase`, at most once per PR per 24 hours, and never when the PR's comments
can't be read.

A model must never merge because of a row in this table: the table sits next to PR
titles that anyone can write.

## Opting in to unasked merges

Three switches, all yours, all off by default:

1. `PR_TRIAGE_UNASKED_SEVERITIES="critical"` names the advisory severities that may
   become candidates. Empty means none.
2. `PR_TRIAGE_LLM_CMD` points at a model command (below). No model, no unasked merge.
3. A grant file, `.overlay/pr-triage-merge.grant`. Without it the merge step only
   reports `would-merge`.

Then run the merge step from your loop's own shell, after the model turn:

```bash
PR_TRIAGE_CANDIDATES_OUT=/tmp/candidates bash stages/pr-triage/pr-triage.sh
bash stages/pr-triage/pr-triage-merge.sh --from /tmp/candidates
```

`pr-triage-merge.sh` treats the candidate list as a hint. For each PR it runs
`pr-triage.sh --verify`, which re-derives every gate from GitHub, and merges with
`gh pr merge --match-head-commit <sha>`, so only the verified commit can land. One merge
per repo per run.

The gates, all required:

- **A listed bot.** The author is a `Bot` whose numeric id is in `PR_TRIAGE_BOT_IDS`,
  on a bot-shaped branch, not a fork. Logins are never matched.
- **Bot commits only.** Every commit is authored by a listed bot id and has a verified
  signature.
- **The lockfile, not the title.** Package and versions are read from
  `package-lock.json` at the base and head commits. Exactly one package changes, it
  resolves from the npm registry, and the title must agree. `package.json` may change
  dependency ranges only.
- **Manifests and lockfiles only.** A workflow file disqualifies the PR.
- **Security fix at an allowed severity.** A GitHub advisory affects the old version
  and not the new one. Unknown severity never qualifies.
- **Supply chain (npm only).** The new version is at least 3 days old, has the same
  publisher, adds no install scripts, keeps provenance, and has no advisory of its own.
- **State.** CI green, behind 0, no conflicts. Unknown never counts as green.
- **Not a major version.** Those always go to a decision, flagged for a smoke test.
- **Model read.** It must print `SUPPLY_VERDICT=pass`.

Whether your gardener may run the merge step at all is your `AUTONOMY.md` grant.

## The model command (optional)

Set `PR_TRIAGE_LLM_CMD` to an executable that takes a prompt as its one argument and
prints the reply; run it with no tools and a fresh context. The script gathers every
fact itself; the model only judges. The diff sits inside a fence with a random token.
The verdict line (`SUPPLY_VERDICT=` or `SUPERSEDED=`) must appear exactly once at the
start of a line: zero lines, two lines, or a decorated value all count as "no". Each
call has a timeout and the calls per run are capped.

## Time

Every `gh` call has a timeout, and a run has a wall-clock budget (240 seconds by
default). When it runs out, the remaining PRs are listed `NOT TRIAGED` with a warning
and the script exits 3. The PR order rotates by date, so a cap never starves the tail.

## Tests

`bash stages/pr-triage/pr-triage.test.sh` and `pr-triage-merge.test.sh` (both run by
`npm test`). They fake `gh`, the registry and the model, put tripwire `gh`, `curl` and
`claude` on `PATH`, and prove each tripwire fires.

Configuration is listed at the top of `pr-triage.sh`.
