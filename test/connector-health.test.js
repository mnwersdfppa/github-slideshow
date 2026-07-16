'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ConnectorHealthMonitor, standardConnectors } = require('../lib/connector-health');

function monitor(check, options = {}) {
  return new ConnectorHealthMonitor({
    connectors: [{ name: 'github', check }], random: () => 0.5, now: () => 100,
    setTimer: () => 1, clearTimer: () => {}, ...options,
  });
}

test('records a credential-free healthy result and marks the check read-only', async () => {
  let context;
  const subject = monitor(async (value) => { context = value; });
  await subject.runNow('github');
  assert.deepEqual(context.readOnly, true);
  assert.equal(context.signal.aborted, false);
  assert.deepEqual(subject.snapshot().github, {
    status: 'healthy', checkedAt: 100, latencyMs: 0, failures: 0, nextCheckAt: null,
  });
});

test('caps exponential backoff, applies jitter, and deduplicates failures until recovery', async () => {
  const incidents = [];
  const recoveries = [];
  let shouldFail = true;
  const subject = monitor(() => {
    if (shouldFail) throw new Error('Bearer super-secret-token');
  }, { baseBackoffMs: 10, maxBackoffMs: 25, random: () => 1, onIncident: (event) => incidents.push(event), onRecovery: (event) => recoveries.push(event) });

  await subject.runNow('github');
  await subject.runNow('github');
  await subject.runNow('github');
  assert.deepEqual(incidents, [{ connector: 'github' }]);
  assert.deepEqual(subject.snapshot().github, {
    status: 'unhealthy', checkedAt: 100, latencyMs: 0, failures: 3, nextCheckAt: 126,
  });
  assert.doesNotMatch(JSON.stringify(subject.snapshot()), /super-secret-token/);

  shouldFail = false;
  await subject.runNow('github');
  assert.deepEqual(recoveries, [{ connector: 'github' }]);
  await subject.runNow('github');
  shouldFail = true;
  await subject.runNow('github');
  assert.equal(incidents.length, 2, 'a recovered connector opens a new incident');
});

test('bounds a hung probe with an abortable timeout', async () => {
  let signal;
  const subject = monitor(({ signal: value }) => {
    signal = value;
    return new Promise(() => {});
  }, { timeoutMs: 10, setTimer: setTimeout, clearTimer: clearTimeout, random: () => 0 });

  await subject.runNow('github');
  assert.equal(signal.aborted, true);
  assert.equal(subject.snapshot().github.status, 'unhealthy');
});

test('standard adapters require all five named read-only connector probes', () => {
  const probes = Object.fromEntries(['linear', 'github', 'dropbox', 'hubspot', 'slack'].map((name) => [name, async () => {}]));
  assert.deepEqual(standardConnectors(probes).map(({ name }) => name), Object.keys(probes));
  assert.throws(() => standardConnectors({}), /missing linear read-only probe/);
});
