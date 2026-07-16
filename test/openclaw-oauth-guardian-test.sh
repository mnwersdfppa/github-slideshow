#!/bin/sh

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/state"

cat >"$tmp/bin/openclaw" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$OPENCLAW_CALL_LOG"
case "$*" in
  'health --json') printf '%s\n' '{"cached":true}' ;;
  'models auth list --provider openai --json') printf '%s\n' "$OPENCLAW_AUTH_JSON" ;;
  'models status --check --json') printf '%s\n' "$OPENCLAW_STATUS_JSON"; exit "${OPENCLAW_STATUS_EXIT:-0}" ;;
  *) exit 99 ;;
esac
EOF
cat >"$tmp/bin/jq" <<'EOF'
#!/bin/sh
exec /usr/bin/jq "$@"
EOF
cat >"$tmp/bin/alert" <<'EOF'
#!/bin/sh
printf '%s\n' "$1" >>"$OPENCLAW_ALERT_LOG"
EOF
chmod +x "$tmp/bin/openclaw" "$tmp/bin/jq" "$tmp/bin/alert" "$root/script/openclaw-oauth-guardian"

run_guardian() {
  PATH="$tmp/bin:$PATH" XDG_STATE_HOME="$tmp/state" OPENCLAW_CALL_LOG="$tmp/calls" \
    OPENCLAW_ALERT_LOG="$tmp/alerts" OPENCLAW_ALERT_COMMAND="$tmp/bin/alert" \
    OPENCLAW_AUTH_JSON="$1" OPENCLAW_STATUS_JSON="$2" OPENCLAW_STATUS_EXIT="${3:-0}" \
    "$root/script/openclaw-oauth-guardian"
}

run_guardian '{"profiles":[]}' '{"auth":{"oauth":[]}}'
test "$(wc -l <"$tmp/alerts")" -eq 1
grep -q 'missing-profile' "$tmp/alerts"
! grep -E 'login|refresh|models set|probe' "$tmp/calls"

# The same incident cannot page twice within the default 24-hour cooldown.
run_guardian '{"profiles":[]}' '{"auth":{"oauth":[]}}'
test "$(wc -l <"$tmp/alerts")" -eq 1

rm -rf "$tmp/state"; mkdir -p "$tmp/state"
run_guardian '{"profiles":[{"provider":"openai","id":"openai:default"}]}' \
  '{"error":"invalid_grant: refresh token revoked"}' 1
grep -q 'permanent-refresh-rejection' "$tmp/alerts"

# Expiry alone is not a permanent rejection and must not force reauthentication.
rm -rf "$tmp/state"; mkdir -p "$tmp/state"
before=$(wc -l <"$tmp/alerts")
run_guardian '{"profiles":[{"provider":"openai","id":"openai:default"}]}' \
  '{"error":"token expired"}' 1
test "$(wc -l <"$tmp/alerts")" -eq "$before"
