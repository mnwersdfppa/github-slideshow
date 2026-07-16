# Automation secret handling

`script/stage` does not accept credentials. Its only optional argument is a
repository slug; invalid values (including URL syntax) are rejected before any
network action. The staging remote is assembled from fixed host and account
values, so tokens cannot be placed in an argv value or URL.

## Deliver credentials safely

Use one of these credential sources for the `ghe.io` host:

1. A provider-managed Git credential helper or OS keychain on a developer
   machine.
2. The CI provider's native secret store wired into its Git credential helper,
   deploy key, or short-lived workload identity.
3. An SSH agent with a deploy key when the remote is configured for SSH.

Do **not** pass a token as the repository argument, in a remote URL, as an
issue or Slack comment, or via `git -c http.extraHeader=...`. Do not enable
`GIT_TRACE`, `GIT_TRACE_CURL`, or verbose curl output around automation.
`script/stage` disables those trace variables, sends command output to a
short-lived `0600` log in a `0700` temporary directory, and emits only a
classified failure message. The directory and log are removed on exit.

## Local clipboard import (break-glass only)

Clipboard history managers and cloud clipboard sync may retain copied values;
this workflow cannot erase those histories. Prefer provider-native storage.
When a local import is unavoidable, paste the value directly into the secret
provider's secure prompt, replace the existing value with the same secret name
(rather than creating a version in a shell history), then clear the active
clipboard immediately. Never use `echo`, command substitution, or a command
argument to transfer the value.

## Rotation and recovery runbook

1. Create a new short-lived credential in the provider and update the
   provider-managed Git helper or CI secret reference. Do not print the value.
2. Run `script/stage` with a valid test repository and verify the generic
   success status. Confirm Git authentication through the provider audit log.
3. Revoke the previous credential and repeat the deployment to verify the new
   credential is active.
4. If a credential may have appeared in output, revoke it immediately, remove
   the affected CI log/artifact according to retention policy, rotate dependent
   credentials, and audit access. Do not paste the suspected value into an
   issue, Slack, or ticket.

The shell checks in `test/stage-security.sh` exercise argument rejection,
secure temporary permissions, redacted failures, and cleanup without using a
real credential or network request.
