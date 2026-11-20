#!/usr/bin/env bash
# pr-triage-merge.sh — the ONLY path that merges a PR-triage candidate.
#
# pr-triage.sh's table ends up in a model's context beside attacker-written PR
# titles, so nothing is ever merged because a row said so, and no model merges
# a triage row. Run this script from your loop's own shell, after the model
# turn. It is deterministic end to end:
#
#  1. DEFAULT OFF, twice. PR_TRIAGE_UNASKED_SEVERITIES is empty by default, so
#     nothing is ever a candidate; and with no grant file
#     (.overlay/pr-triage-merge.grant, PR_TRIAGE_MERGE_GRANT to override) it
#     verifies and prints `would-merge`, and never calls gh pr merge. The
#     operator creates the grant; delete it to revoke.
#  2. The candidate list is only a hint. Each ref is shape-checked, then
#     `pr-triage.sh --verify` re-derives EVERY gate fresh for that PR (listed
#     bot id, signed bot commits, lockfile truth, advisories, supply chain,
#     CI green, behind 0, no conflicts, not a major, LLM read). A forged or
#     stale list can only cause a PR to be verified, never merged.
#  3. Every gate is re-read here from the verify output, one by one; a field
#     named twice is refused (a repeat is how a forged line would win).
#  4. The merge is PINNED: the PR's head must still be the verified commit, and
#     `gh pr merge --match-head-commit` makes GitHub refuse if it moved.
#  5. One merge per repo per run (lockfiles collide), PR_TRIAGE_MERGE_MAX total.
#  6. Fail-soft: any doubt => skip with a reason, never a crash, never a merge.
#
# Usage: pr-triage-merge.sh --from <file of owner/repo#N lines>
# Output: `MERGE|<ref>|<merged|would-merge|skip|refused>|<reason>` lines.
# Injectable: PR_TRIAGE_GH, PR_TRIAGE_MERGE_VERIFY. Needs bash 3.2+, jq, gh.
set -uo pipefail

GH="${PR_TRIAGE_GH:-gh}"
HERE="$(cd "$(dirname "$0")" && pwd)"
VERIFY="${PR_TRIAGE_MERGE_VERIFY:-${HERE}/pr-triage.sh}"
GRANT="${PR_TRIAGE_MERGE_GRANT:-.overlay/pr-triage-merge.grant}"
MAX="${PR_TRIAGE_MERGE_MAX:-3}"
FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="${2:-}"; shift 2 ;;
    *)      shift ;;
  esac
done

emit() { printf 'MERGE|%s|%s|%s\n' "$1" "$2" "$3"; }
field() { printf '%s\n' "$1" | awk -F'|' -v k="$2" '$1=="TRIAGE" && $2==k {print $3; exit}'; }
dups()  { printf '%s\n' "$1" | awk -F'|' '$1=="TRIAGE" {c[$2]++} END {for (k in c) if (c[k] > 1) printf "%s ", k}'; }
is_sha() { case "$1" in ''|*[!0-9a-f]*) return 1 ;; esac; [ "${#1}" -eq 40 ] || [ "${#1}" -eq 64 ]; }

if ! command -v "$GH" >/dev/null 2>&1 || ! "$GH" auth status >/dev/null 2>&1; then
  emit - refused "gh unavailable/unauthenticated — nothing verified or merged"; exit 2
fi
[ -n "$FROM" ] && [ -f "$FROM" ] || { emit - refused "usage: --from <candidates file>"; exit 2; }

merged=0; done_repos=" "
while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  printf '%s' "$ref" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+#[1-9][0-9]*$' || { emit - skip "malformed candidate line"; continue; }
  repo="${ref%%#*}"; pr="${ref##*#}"
  case "${repo#*/}" in .|..) emit - skip "malformed candidate line"; continue ;; esac
  case "$done_repos" in *" $repo "*) emit "$ref" skip "one merge per repo per run — waits for the next cycle"; continue ;; esac
  [ "$merged" -lt "$MAX" ] || { emit "$ref" skip "merge cap ($MAX) reached this run"; continue; }

  V="$("$VERIFY" --verify -R "$repo" "$pr" 2>/dev/null)" || V=""
  d="$(dups "$V")"
  [ -n "$d" ] && { emit "$ref" skip "verify output names a field twice (${d% }) — nothing merged"; continue; }
  [ "$(field "$V" pr)" = "$ref" ] || { emit "$ref" skip "verify did not answer for this PR"; continue; }
  bad=""
  for kv in unasked_merge=true state=candidate ci=green behind=0 conflict=no security=yes severity_allowed=true \
            major=no supply=pass scope=pass lockfile=pass commits=pass llm=pass head_moved=false; do
    k="${kv%%=*}"; want="${kv#*=}"; got="$(field "$V" "$k")"
    [ "$got" = "$want" ] || bad="$bad $k=${got:-missing}"
  done
  [ -n "$bad" ] && { emit "$ref" skip "not verified:${bad}"; continue; }
  sha="$(field "$V" head_sha)"
  is_sha "$sha" || { emit "$ref" skip "verify recorded no head SHA — cannot pin the merge"; continue; }
  cur="$("$GH" pr view "$pr" -R "$repo" --json headRefOid 2>/dev/null | jq -r '.headRefOid // ""' 2>/dev/null)" || cur=""
  [ "$cur" = "$sha" ] || { emit "$ref" skip "PR head is not the verified commit — nothing merged"; continue; }

  done_repos="$done_repos$repo "
  if [ ! -f "$GRANT" ]; then
    emit "$ref" would-merge "every gate passed at $sha; grant file absent — dry-run, not merging"
    continue
  fi
  if "$GH" pr merge "$pr" -R "$repo" --squash --match-head-commit "$sha" >/dev/null 2>&1; then
    merged=$((merged+1)); emit "$ref" merged "security fix, verified and merged at $sha"
  else
    emit "$ref" skip "gh pr merge failed at $sha — left for a human"
  fi
done < "$FROM"
exit 0
