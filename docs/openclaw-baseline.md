# OpenClaw latency and throughput baseline

Run this baseline **before** changing the model tier, queue mode, or worker
concurrency. It measures completed user task events, not synthetic probes.

## Event export contract

Export one JSON object per task to JSONL. Required fields are `received_at`,
`started_at`, `completed_at`, and `status` (`success` or `failed`). Timestamps
must be ISO-8601 UTC. Include `retry_count` (zero when no retry) and the
optional timestamp pairs below when the task reaches those layers:

| Metric | Timestamp pair |
| --- | --- |
| model latency | `model_started_at` → `model_completed_at` |
| connector latency | `connector_started_at` → `connector_completed_at` |
| gateway latency | `gateway_started_at` → `gateway_completed_at` |

Mark health checks and telemetry with `"traffic_class":"monitoring"` (or
`"monitoring":true`). The analyzer excludes them. Collect health status from a
cached snapshot created before the run; do not issue health probes as part of
the measurement window. Health snapshot records are operational context, not
task events, and are not included in the report.

## Run and record

```sh
python3 tools/openclaw_baseline.py --input artifacts/openclaw-events.jsonl \
  --output artifacts/openclaw-baseline.json
```

Attach the input window, cached health snapshot timestamp, generated report,
model tier, queue mode, worker count, and write-approval policy to the change
record. Keep the existing response-quality evaluation and write approvals in
place; this tool neither sends tasks nor changes approvals.

The report gives p50/p95 task latency and queue wait, separated p50/p95 model,
connector, and gateway latency, failure rate, total retries, and completed-task
throughput. Missing component timestamps are reported as zero samples rather
than being guessed.

## Concurrency decision and rollback

Do not raise concurrency from this report alone. A bounded change is eligible
only when the report has a positive queue-wait p95 **and** identifies a
component bottleneck; investigate that bottleneck first. Start with the
smallest worker increment and repeat the exact export window and quality set.

Record these rollback thresholds before applying the change:

| Signal | Roll back when |
| --- | --- |
| p95 task latency | more than 20% above the approved baseline |
| failure rate | more than 1 percentage point above baseline |
| retry count per task | more than 25% above baseline |
| response quality or write approval | any regression or approval bypass |

Roll back to the prior model tier, queue mode, and worker bound immediately if
any threshold is crossed. Preserve both baseline and post-change reports so the
decision is auditable.
