# Legacy Notion–Telegram scheduler audit

## Disposition

This repository is a GitHub Learning Lab/Jekyll slide-show project. It is **not**
the source of truth or deployment target for the legacy Notion–Telegram
scheduler mentioned in HEL-9. The audit completed on 2026-07-16 found no
scheduler source, cron configuration, Notion client, Telegram client, secret
configuration, or automation dependency in the tracked files or reachable Git
history.

Do not add the scheduler to this repository or deploy it from here. Its owner
must maintain it in the intended OpenClaw integrations repository, with that
repository's deployment runbook and monitoring. A scheduler migration should
include its implementation, tests, and deployment configuration there before
it is enabled.

## Safety requirements for the owning repository

The scheduler must meet all of the following before deployment:

1. Do not request, store, or add `OPENAI_API_KEY`; this integration does not
   use OpenAI.
2. Keep `.env` out of version control and resolve any environment file from the
   executing script's directory rather than the caller's working directory.
3. Redact Telegram bot tokens from URLs, log messages, errors, and health
   details. Never include a token in an exception message.
4. Exit nonzero when a Notion or Telegram network operation ultimately fails,
   and publish a structured health record with status, timestamp, operation,
   attempt count, and a sanitized error code/message.
5. Use a finite retry budget with exponential backoff and jitter. Retry only
   transient failures and make outbound writes idempotent with a stable
   idempotency key.
6. Bound Notion row creation: create at most one row per scheduled period and
   first look up the stable period/idempotency key. Do not create a new row on
   every 15-minute invocation.
7. Pin runtime dependencies with the ecosystem lockfile (or exact versions
   where no lockfile exists), and review updates in the owning repository.

## Repository hygiene

The root `.gitignore` excludes `.env` to prevent accidental local-secret
commits. The existing `Gemfile.lock` and `package-lock.json` remain the pinned
dependency records for this slide-show project; neither configures the retired
scheduler.
