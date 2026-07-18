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
    status: 'unhealthy', checkedAt: 100, latencyMs: 0, failures: 3, nextCheckAt: 125,
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

test('bounds a hung probe and suppresses retries until it settles', async () => {
  const finish = [];
  let calls = 0;
  let signal;
  const subject = monitor(({ signal: value }) => {
    calls += 1;
    signal = value;
    return new Promise((resolve) => finish.push(resolve));
  }, { timeoutMs: 10, setTimer: setTimeout, clearTimer: clearTimeout, random: () => 0 });

  await subject.runNow('github');
  await subject.runNow('github');
  assert.equal(calls, 1, 'a timed-out probe remains the sole in-flight request');
  assert.equal(signal.aborted, true);
  assert.equal(subject.snapshot().github.status, 'unhealthy');
  assert.equal(subject.snapshot().github.nextCheckAt, null);

  finish[0]();
  await new Promise((resolve) => setImmediate(resolve));
  await subject.runNow('github');
  assert.equal(calls, 2, 'probing resumes only after the abandoned request settles');
  finish[1]();
});

test('rejects non-finite timeout and backoff values', () => {
  for (const value of [NaN, Infinity]) {
    assert.throws(() => monitor(async () => {}, { timeoutMs: value }), RangeError);
    assert.throws(() => monitor(async () => {}, { baseBackoffMs: value }), RangeError);
    assert.throws(() => monitor(async () => {}, { maxBackoffMs: value }), RangeError);
  }
});

test('rejects delays above the Node timer limit', () => {
  const overflow = 2_147_483_648;
  assert.throws(() => monitor(async () => {}, { timeoutMs: overflow }), RangeError);
  assert.throws(() => monitor(async () => {}, { baseBackoffMs: overflow, maxBackoffMs: overflow }), RangeError);
  assert.throws(() => monitor(async () => {}, { maxBackoffMs: overflow }), RangeError);
});

test('keeps full jitter within a fractional cap', async () => {
  const subject = monitor(() => { throw new Error('probe failed'); }, {
    baseBackoffMs: 1.5,
    maxBackoffMs: 1.5,
    random: () => 1,
  });
  await subject.runNow('github');
  assert.equal(subject.snapshot().github.nextCheckAt, 101.5);
});

test('preserves connector state for special property names', async () => {
  const subject = new ConnectorHealthMonitor({
    connectors: [{ name: '__proto__', check: async () => {} }],
    setTimer: () => 1,
    clearTimer: () => {},
    now: () => 100,
  });
  await subject.runNow('__proto__');
  const snapshot = subject.snapshot();
  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
  assert.equal(Object.hasOwn(snapshot, '__proto__'), true);
  assert.equal(snapshot.__proto__.status, 'healthy');
  assert.match(JSON.stringify(snapshot), /__proto__/);
});

test('swallows rejected async alert callbacks', async () => {
  const subject = monitor(() => { throw new Error('probe failed'); }, {
    onIncident: async () => { throw new Error('alert delivery failed'); },
  });
  await subject.runNow('github');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(subject.snapshot().github.status, 'unhealthy');
});

test('stop ignores results and alerts from in-flight probes', async () => {
  const incidents = [];
  let rejectProbe;
  const subject = monitor(() => new Promise((_, reject) => { rejectProbe = reject; }), {
    onIncident: (event) => incidents.push(event),
  });
  subject.start();
  const running = subject.runNow('github');
  await Promise.resolve();
  subject.stop();
  rejectProbe(new Error('probe failed after stop'));
  await running;
  assert.deepEqual(subject.snapshot().github, {
    status: 'unknown', checkedAt: null, latencyMs: null, failures: 0, nextCheckAt: null,
  });
  assert.deepEqual(incidents, []);
});

test('stop clears the in-flight timeout and aborts the probe', async () => {
  let nextTimerId = 0;
  const timers = new Map();
  let signal;
  const subject = monitor(({ signal: value }) => {
    signal = value;
    return new Promise(() => {});
  }, {
    setTimer: (callback, delay) => {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });

  subject.start();
  const kickoff = [...timers].find(([, timer]) => timer.delay === 0);
  assert.ok(kickoff);
  timers.delete(kickoff[0]);
  kickoff[1].callback();
  await Promise.resolve();
  assert.ok([...timers.values()].some((timer) => timer.delay === 2_000));
  subject.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signal.aborted, true);
  assert.equal(timers.size, 0);
  assert.equal(subject.snapshot().github.status, 'unknown');
});

test('stop clears stale in-flight guards without releasing a restarted probe', async () => {
  let nextTimerId = 0;
  const timers = new Map();
  const finish = [];
  let calls = 0;
  const setTimer = (callback, delay) => {
    const id = ++nextTimerId;
    timers.set(id, { callback, delay });
    return id;
  };
  const fire = (delay) => {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `missing timer with delay ${delay}`);
    timers.delete(entry[0]);
    entry[1].callback();
  };
  const subject = monitor(() => {
    calls += 1;
    return new Promise((resolve) => finish.push(resolve));
  }, { timeoutMs: 10, setTimer, clearTimer: (id) => timers.delete(id) });

  subject.start();
  fire(0);
  await Promise.resolve();
  fire(10);
  await new Promise((resolve) => setImmediate(resolve));
  subject.stop();
  subject.start();
  fire(0);
  await Promise.resolve();
  assert.equal(calls, 2, 'restart launches a fresh probe while the old request is abandoned');

  finish[0]();
  await new Promise((resolve) => setImmediate(resolve));
  await subject.runNow('github');
  assert.equal(calls, 2, 'the old completion cannot release the restarted probe guard');
  finish[1]();
  await new Promise((resolve) => setImmediate(resolve));
  subject.stop();
});

test('publishes retry time when a timed-out probe settles', async () => {
  let nextTimerId = 0;
  const timers = new Map();
  let finish;
  const setTimer = (callback, delay) => {
    const id = ++nextTimerId;
    timers.set(id, { callback, delay });
    return id;
  };
  const fire = (delay) => {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `missing timer with delay ${delay}`);
    timers.delete(entry[0]);
    entry[1].callback();
  };
  const subject = monitor(() => new Promise((resolve) => { finish = resolve; }), {
    timeoutMs: 10,
    baseBackoffMs: 10,
    maxBackoffMs: 10,
    random: () => 0.5,
    setTimer,
    clearTimer: (id) => timers.delete(id),
  });

  subject.start();
  fire(0);
  await Promise.resolve();
  fire(10);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(subject.snapshot().github.nextCheckAt, null);
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(subject.snapshot().github.nextCheckAt, 105);
  assert.ok([...timers.values()].some((timer) => timer.delay === 5));
  subject.stop();
});

test('standard adapters require all five named read-only connector probes', () => {
  const probes = Object.fromEntries(['linear', 'github', 'dropbox', 'hubspot', 'slack'].map((name) => [name, async () => {}]));
  assert.deepEqual(standardConnectors(probes).map(({ name }) => name), Object.keys(probes));
  assert.throws(() => standardConnectors({}), /missing linear read-only probe/);
});
