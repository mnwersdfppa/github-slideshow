import importlib.util
import unittest


spec = importlib.util.spec_from_file_location("baseline", "tools/openclaw_baseline.py")
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)


class BaselineTests(unittest.TestCase):
    def test_excludes_monitoring_and_separates_latency_layers(self):
        events = [
            {"received_at": "2026-07-16T00:00:00Z", "started_at": "2026-07-16T00:00:01Z", "completed_at": "2026-07-16T00:00:11Z", "model_started_at": "2026-07-16T00:00:02Z", "model_completed_at": "2026-07-16T00:00:05Z", "connector_started_at": "2026-07-16T00:00:05Z", "connector_completed_at": "2026-07-16T00:00:07Z", "gateway_started_at": "2026-07-16T00:00:07Z", "gateway_completed_at": "2026-07-16T00:00:11Z", "status": "success", "retry_count": 2},
            {"received_at": "2026-07-16T00:00:00Z", "started_at": "2026-07-16T00:00:02Z", "completed_at": "2026-07-16T00:00:12Z", "status": "failed", "retry_count": 1},
            {"traffic_class": "monitoring", "received_at": "2026-07-16T00:00:00Z", "started_at": "2026-07-16T00:00:01Z", "completed_at": "2026-07-16T00:01:00Z", "status": "success"},
        ]
        report = baseline.summarize(events)
        self.assertEqual(report["included_task_events"], 2)
        self.assertEqual(report["monitoring_events_excluded"], 1)
        self.assertEqual(report["failure_rate"], 0.5)
        self.assertEqual(report["retry_count"], 3)
        self.assertEqual(report["metrics"]["task_latency_ms"]["p50_ms"], 11500.0)
        self.assertEqual(report["metrics"]["model_latency_ms"]["p95_ms"], 3000.0)
        self.assertEqual(report["metrics"]["connector_latency_ms"]["p50_ms"], 2000.0)
        self.assertEqual(report["metrics"]["gateway_latency_ms"]["p50_ms"], 4000.0)

    def test_declines_concurrency_change_without_queueing(self):
        report = baseline.summarize([{"received_at": "2026-07-16T00:00:00Z", "started_at": "2026-07-16T00:00:00Z", "completed_at": "2026-07-16T00:00:01Z", "status": "success"}])
        self.assertIn("Do not change concurrency", report["concurrency_recommendation"])


if __name__ == "__main__":
    unittest.main()
