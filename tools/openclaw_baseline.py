#!/usr/bin/env python3
"""Produce a comparable OpenClaw latency baseline from task-event JSONL.

The input is deliberately an export format rather than a live probe: health
checks remain cached and monitoring traffic cannot pollute task measurements.
See docs/openclaw-baseline.md for the event contract.
"""

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


TIME_FIELDS = {
    "task_latency_ms": ("received_at", "completed_at"),
    "queue_wait_ms": ("received_at", "started_at"),
    "model_latency_ms": ("model_started_at", "model_completed_at"),
    "connector_latency_ms": ("connector_started_at", "connector_completed_at"),
    "gateway_latency_ms": ("gateway_started_at", "gateway_completed_at"),
}


def parse_time(value):
    """Return a timezone-aware timestamp, accepting the normal ISO-8601 Z form."""
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def duration_ms(event, start, end):
    first, last = parse_time(event.get(start)), parse_time(event.get(end))
    if not first or not last:
        return None
    return round((last - first).total_seconds() * 1000, 3)


def percentile(values, percentile):
    """Linearly interpolated percentile, stable for small baseline samples."""
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile
    lower, upper = int(position), min(int(position) + 1, len(ordered) - 1)
    return round(ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower), 3)


def is_monitoring(event):
    return event.get("traffic_class") == "monitoring" or event.get("monitoring") is True


def summarize(events):
    """Summarize completed task events and return a JSON-serializable report."""
    included = [event for event in events if not is_monitoring(event)]
    monitoring_excluded = len(events) - len(included)
    metrics = {name: [] for name in TIME_FIELDS}
    statuses = Counter()
    retries = 0
    completed_times = []

    for event in included:
        statuses[event.get("status", "unknown")] += 1
        retries += max(0, int(event.get("retry_count", 0)))
        completed = parse_time(event.get("completed_at"))
        if completed:
            completed_times.append(completed)
        for name, (start, end) in TIME_FIELDS.items():
            value = duration_ms(event, start, end)
            if value is not None and value >= 0:
                metrics[name].append(value)

    total = len(included)
    metric_report = {
        name: {"samples": len(values), "p50_ms": percentile(values, .50), "p95_ms": percentile(values, .95)}
        for name, values in metrics.items()
    }
    elapsed_seconds = (max(completed_times) - min(completed_times)).total_seconds() if len(completed_times) > 1 else 0
    throughput = None if elapsed_seconds == 0 else round(len(completed_times) / elapsed_seconds, 3)
    component_p95 = {
        name: data["p95_ms"] for name, data in metric_report.items()
        if name not in {"task_latency_ms", "queue_wait_ms"} and data["p95_ms"] is not None
    }
    bottleneck = max(component_p95, key=component_p95.get) if component_p95 else None
    queue_p95 = metric_report["queue_wait_ms"]["p95_ms"]
    recommendation = (
        "Investigate %s before changing concurrency; queueing is measurable." % bottleneck
        if bottleneck and queue_p95 and queue_p95 > 0 else
        "Do not change concurrency: this baseline does not show measurable queueing and a component bottleneck."
    )
    return {
        "included_task_events": total,
        "monitoring_events_excluded": monitoring_excluded,
        "health_snapshot_policy": "cached snapshots only; health snapshot events are not task measurements",
        "metrics": metric_report,
        "failure_rate": round(statuses["failed"] / total, 6) if total else None,
        "failure_count": statuses["failed"],
        "retry_count": retries,
        "throughput_tasks_per_second": throughput,
        "bottleneck_candidate": bottleneck,
        "concurrency_recommendation": recommendation,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="JSONL task-event export")
    parser.add_argument("--output", type=Path, help="write report here instead of stdout")
    args = parser.parse_args()
    with args.input.open(encoding="utf-8") as source:
        events = [json.loads(line) for line in source if line.strip()]
    rendered = json.dumps(summarize(events), indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
