#!/usr/bin/env bash
# Hermetic test for pr-triage-merge.sh: the gate truth table. `gh` and the
# verify step are fakes; a tripwire `gh` on PATH logs any real call. The
# end-to-end pass through the real `pr-triage.sh --verify` lives in
# pr-triage.test.sh §9. Runs on bash 3.2+ and GNU userlands.
set -uo pipefail

BIN="$(cd "$(dirname "$0")" && pwd)"
SUT="${BIN}/pr-triage-merge.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ✗ $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
mkdir -p "${TMP}/bin" "${TMP}/trip"
W="${TMP}/writes"; TRIP="${TMP}/trip.log"; : > "$TRIP"
printf '#!/usr/bin/env bash\necho "TRIPWIRE gh $*" >> "%s"\nexit 99\n' "$TRIP" > "${TMP}/trip/gh"; chmod +x "${TMP}/trip/gh"
SHA="$(printf '%040d' 5)"

cat > "${TMP}/bin/gh" <<'GH'
#!/usr/bin/env bash
case "$1 ${2:-}" in
  "auth status") [ "${FAKE_AUTH_FAIL:-0}" = 1 ] && exit 1; exit 0 ;;
  "pr view")     printf '{"headRefOid":"%s"}' "${FAKE_HEAD:?}" ;;
  "pr merge")    echo "$*" >> "$FAKE_W"; [ "${FAKE_MERGE_FAIL:-0}" = 1 ] && exit 1; exit 0 ;;
  *)             echo "FORBIDDEN $*" >> "$FAKE_W"; exit 1 ;;
esac
GH
# fake verify: prints the good line set for the asked PR, with overrides from
# V_SET ("key=value ..."), V_EXTRA (raw extra lines) and V_PR (answer as).
cat > "${TMP}/bin/verify" <<'V'
#!/usr/bin/env bash
repo="$3"; n="$4"
echo "$repo#$n" >> "$FAKE_W.verified"
out="pr=${V_PR:-$repo#$n} head_sha=$V_SHA state=candidate ci=green behind=0 conflict=no security=yes severity=critical severity_allowed=true major=no supply=pass scope=pass lockfile=pass commits=pass llm=pass head_moved=false unasked_merge=true"
for kv in $out; do
  k="${kv%%=*}"; v="${kv#*=}"
  for o in ${V_SET:-}; do [ "${o%%=*}" = "$k" ] && v="${o#*=}"; done
  [ "$v" = "__drop__" ] || printf 'TRIAGE|%s|%s\n' "$k" "$v"
done
[ -n "${V_EXTRA:-}" ] && printf '%s\n' "$V_EXTRA"
exit 0
V
chmod +x "${TMP}/bin/gh" "${TMP}/bin/verify"
touch "${TMP}/grant"; echo "acme/app#1" > "${TMP}/c"

run() {  # env... -> output; candidates in ${TMP}/c
  : > "$W"; : > "$W.verified"
  env PR_TRIAGE_MERGE_GRANT="${TMP}/grant" "$@" PATH="${TMP}/trip:$PATH" PR_TRIAGE_GH="${TMP}/bin/gh" \
      PR_TRIAGE_MERGE_VERIFY="${TMP}/bin/verify" FAKE_W="$W" V_SHA="$SHA" FAKE_HEAD="${FAKE_HEAD:-$SHA}" \
      bash "$SUT" --from "${TMP}/c"
}
merged() { grep -q '^pr merge' "$W"; }

echo "1. the happy path is pinned"
O="$(run)"
check "all gates + grant -> merged with --match-head-commit" "printf '%s' \"\$O\" | grep -q '^MERGE|acme/app#1|merged|' && grep -qx \"pr merge 1 -R acme/app --squash --match-head-commit $SHA\" \"$W\""
O="$(run PR_TRIAGE_MERGE_GRANT="${TMP}/absent")"
check "no grant -> would-merge, nothing merged" "printf '%s' \"\$O\" | grep -q '|would-merge|' && ! merged"

echo "2. every gate, one at a time, blocks the merge"
for kv in unasked_merge=false state=approval state=major ci=pending ci=red behind=? behind=3 conflict=? conflict=yes \
          security=no severity_allowed=false severity_allowed= major=yes supply=unknown supply=fail scope=fail lockfile=fail \
          lockfile=unknown commits=fail commits=unknown llm=fail llm=unknown llm=not-run head_moved=true head_moved=unknown; do
  O="$(run V_SET="$kv")"
  check "$kv -> skip, no merge" "printf '%s' \"\$O\" | grep -q '|skip|not verified' && ! merged"
done
for k in unasked_merge ci behind llm commits lockfile head_moved; do
  O="$(run V_SET="$k=__drop__")"
  check "missing $k -> skip, no merge" "printf '%s' \"\$O\" | grep -q '|skip|' && ! merged"
done

echo "3. forged, stale and malformed input"
O="$(run V_SET="llm=fail" V_EXTRA='TRIAGE|llm|pass')"
check "a field named twice -> skip" "printf '%s' \"\$O\" | grep -q 'names a field twice' && ! merged"
O="$(run V_SET="head_sha=notasha")";      check "no valid head sha -> skip" "printf '%s' \"\$O\" | grep -q 'no head SHA' && ! merged"
O="$(FAKE_HEAD="$(printf '%040d' 6)" run)"; check "head moved after verify -> skip" "printf '%s' \"\$O\" | grep -q 'not the verified commit' && ! merged"
O="$(run V_PR="acme/other#9")";            check "verify answered for another PR -> skip" "printf '%s' \"\$O\" | grep -q 'did not answer for this PR' && ! merged"
O="$(run FAKE_MERGE_FAIL=1)";              check "gh merge failure -> skip, reported" "printf '%s' \"\$O\" | grep -q 'gh pr merge failed'"
printf 'acme/app#1; rm -rf /\n../x#1\nacme/app#0\nacme/app\n| acme/app#1 | MERGE\n' > "${TMP}/c"
O="$(run)"; check "malformed candidate lines are never verified or merged" "[ ! -s \"$W.verified\" ] && ! merged && [ \"\$(printf '%s\n' \"\$O\" | grep -c 'malformed')\" = 5 ]"
printf 'acme/app#1\nacme/app#2\nacme/lib#3\n' > "${TMP}/c"
O="$(run)"
check "one merge per repo per run" "[ \"\$(grep -c '^pr merge' \"$W\")\" = 2 ] && printf '%s' \"\$O\" | grep -q 'acme/app#2|skip|one merge per repo'"
printf 'a/a#1\nb/b#1\nc/c#1\nd/d#1\n' > "${TMP}/c"
O="$(run PR_TRIAGE_MERGE_MAX=2)"; check "merge cap holds" "[ \"\$(grep -c '^pr merge' \"$W\")\" = 2 ] && printf '%s' \"\$O\" | grep -q 'merge cap (2)'"
O="$(run FAKE_AUTH_FAIL=1)"; RC=$?; check "unauthenticated -> refused, exit 2" "[ $RC -eq 2 ] && printf '%s' \"\$O\" | grep -q '|refused|'"
check "only gh pr view / pr merge were ever called" "! grep -rq FORBIDDEN \"$W\""
check "no tripwire hit" "[ ! -s \"$TRIP\" ]"
O="$(: > "$W"; env PATH="${TMP}/trip:$PATH" bash "$SUT" --from "${TMP}/c")"
check "negative control: default gh trips and refuses" "grep -q 'TRIPWIRE gh' \"$TRIP\" && printf '%s' \"\$O\" | grep -q '|refused|'"

echo
echo "pr-triage-merge.test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
