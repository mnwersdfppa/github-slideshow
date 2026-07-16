#!/bin/sh

set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
stage="$repo_root/script/stage"

assert_contains() {
  needle=$1
  file=$2
  if ! grep -F "$needle" "$file" >/dev/null; then
    printf 'Expected %s in %s\n' "$needle" "$file" >&2
    exit 1
  fi
}

output=$(mktemp)
fake_bin=$(mktemp -d)
trap 'rm -rf "$fake_bin"; rm -f "$output"' EXIT HUP INT TERM

if "$stage" 'owner/repo' >"$output" 2>&1; then
  printf '%s\n' 'Unsafe repository argument was accepted.' >&2
  exit 1
fi
assert_contains 'Usage: script/stage' "$output"

cat >"$fake_bin/bundle" <<'EOF'
#!/bin/sh
printf '%s\n' 'upstream response: test-secret-must-not-be-logged' >&2
exit 1
EOF
chmod 700 "$fake_bin/bundle"
if PATH="$fake_bin:$PATH" "$stage" safe-repo >"$output" 2>&1; then
  printf '%s\n' 'A failed build unexpectedly succeeded.' >&2
  exit 1
fi
assert_contains 'Build failed.' "$output"
if grep -F 'test-secret-must-not-be-logged' "$output" >/dev/null; then
  printf '%s\n' 'Upstream output was exposed.' >&2
  exit 1
fi

assert_contains 'umask 077' "$stage"
assert_contains 'chmod 700 "$work_dir"' "$stage"
assert_contains 'chmod 600 "$log_file"' "$stage"
assert_contains 'GIT_TERMINAL_PROMPT=0' "$stage"
assert_contains 'GIT_TRACE_CURL' "$stage"
assert_contains '>>"$log_file" 2>&1' "$stage"
assert_contains 'rm -f "$log_file"' "$stage"

printf '%s\n' 'stage security checks passed'
