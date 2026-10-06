#!/usr/bin/env bash
# tools/sanitize-scan.sh — fail if any commit-unsafe pattern appears in tracked files.
# Layer 1 (below) is credential/machine shapes. Layer 2 (tools/particulars.js) is
# org/person/narrative particulars. Both are deterministic and both fail closed.
#
# Usage: sanitize-scan.sh [--substrate] [paths...]
#   (no args)     both layers over the whole tracked tree — the only whole-tree clean bill
#   paths...      both layers over exactly those paths; the summary says it was partial
#   --substrate   Layer 2 narrowed to the substrate (instance_paths excluded); Layer 1
#                 still covers the whole tree, because scanning MORE can only ever be a
#                 false red, and a narrowing that turns a real hit green is the bug this
#                 flag used to have.
set -uo pipefail
# Loud, not silent: without the guard a failed `cd` left the gate scanning whatever
# directory it happened to be in, and `git ls-files` returning nothing there reads exactly
# like a clean tree.
cd "$(dirname "$0")/.." || { echo "SANITIZE FAIL: cannot enter the repo root — nothing was scanned."; exit 1; }

# Split argv: flags go to Layer 2 only, paths go to BOTH layers. Before this split,
# `sanitize-scan.sh README.md` narrowed Layer 2 to one file while Layer 1 silently
# scanned the whole tree, and the summary still claimed an unqualified clean.
flags=()
paths=()
for a in "$@"; do
  case "$a" in
    --*) flags+=("$a") ;;
    *)   paths+=("$a") ;;
  esac
done

# The file list is held as an ARRAY and handed to grep NUL-delimited. It used to be a
# newline-joined string piped into a bare `xargs`, which broke the scan two ways at once,
# both silently:
#   * `xargs` splits on whitespace and honours quotes, so a tracked `my notes.md` arrived
#     as two arguments — `my` and `notes.md` — neither of which exists;
#   * `git ls-files` C-QUOTES any path with a non-ASCII or control character, so
#     `résumé.md` arrived as the literal characters `"r\303\251sum\303\251.md"` — which
#     also does not exist.
# In both cases grep's "No such file or directory" went to the 2>/dev/null below and the
# file was never scanned. A tracked file with a space in its name could carry a PEM header
# and the gate still printed `✓ sanitize scan clean`.
files=()
scope_note=""
if [ "${#paths[@]}" -gt 0 ]; then
  files=("${paths[@]}")
  scope_note=" (partial: ${#paths[@]} path(s) — NOT a whole-tree clean bill)"
else
  # -z: NUL-delimited and, crucially, UNQUOTED — the only output of ls-files that
  # round-trips every legal path.
  while IFS= read -r -d '' f; do files+=("$f"); done < <(git ls-files -z)
  for f in ${flags[@]+"${flags[@]}"}; do
    [ "$f" = "--substrate" ] && scope_note=" (Layer 2 narrowed to --substrate)"
  done
fi

rc=0
scan() { # $1=label  $2=grep flags (after -n)  $3=pattern
  local out errs hits
  [ "${#files[@]}" -eq 0 ] && return 0
  # `-e` is load-bearing. A pattern beginning with `-` (a PEM header) is otherwise parsed
  # by grep as options; grep errors out, and the error used to be swallowed — which is how
  # the privatekey pattern managed to never match anything.
  #
  # Test the OUTPUT, not the exit status: xargs splits into several greps once the
  # argument list is long, and the pipeline reports only the LAST grep's status — a hit
  # in an earlier batch would otherwise be silently dropped as a tree grows.
  #
  # stderr is KEPT rather than discarded, and anything on it fails the gate. Every bug this
  # function has had announced itself on stderr first and was thrown away; a scan that
  # could not read what it was pointed at has not cleared it.
  #
  # It is folded in with 2>&1 and split back out by prefix, rather than captured to a temp
  # file, so that this function needs nothing on PATH beyond what it already greps with. A
  # `mktemp` here would be a dependency that, when absent, silences Layer 1 completely —
  # which is the exact class of quiet failure this commit exists to remove. `grep:` and
  # `xargs:` are the only prefixes either tool diagnoses with; a hit is `path:lineno:…`.
  out=$(printf '%s\0' "${files[@]}" | xargs -0 grep -n"$2" -e "$3" 2>&1)
  errs=$(printf '%s\n' "$out" | grep -E '^(grep|xargs):' || true)
  hits=$(printf '%s\n' "$out" | grep -vE '^(grep|xargs):' || true)
  [ -n "$errs" ] && {
    echo "SANITIZE FAIL [$1]: the scan itself errored, so this is not a clean bill:"
    printf '%s\n' "$errs" | sed 's/^/  /'
    rc=1
  }
  [ -n "$hits" ] && { echo "SANITIZE FAIL [$1]:"; echo "$hits"; rc=1; }
}
scan home-path  EI '/Users/[a-z]'
scan tailnet    EI '\.ts\.net'
# Assembled at runtime for the same reason as the framework name below: the literal
# pattern written out in this file would otherwise be a hit on this file.
PK="$(printf '%s' '-----' 'BEGIN')"; scan privatekey FI "$PK"
scan uuid       EI '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
scan phone      EI '\+[0-9]{10,}'
FW="$(printf '%s' 'egr' 'egore')"; scan framework FiI "$FW"

# Layer 2 — particulars. Fails CLOSED when node is missing: this is a node artefact, and
# a gate that reports clean because half of it never ran is worse than no gate at all.
# (The optional semantic lane inside it is the opposite — it degrades silently, because
# it is advisory and must never be what stands between a particular and the public.)
if command -v node >/dev/null 2>&1; then
  node tools/particulars.js ${flags[@]+"${flags[@]}"} ${paths[@]+"${paths[@]}"} || rc=1
else
  echo "SANITIZE FAIL [particulars]: node not found — Layer 2 did NOT run."; rc=1
fi

[ "$rc" -eq 0 ] && echo "✓ sanitize scan clean${scope_note}"
exit "$rc"
