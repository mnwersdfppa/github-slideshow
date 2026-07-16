'use strict';

/**
 * A small, dependency-free monitor for optional integration connectors.
 *
 * The monitor intentionally knows nothing about connector credentials or
 * clients. Callers provide a read-only `check` function, which keeps probing
 * isolated from both connector writes and application/session creation.
 */
class ConnectorHealthMonitor {
  constructor({
    connectors,
    timeoutMs = 2_000,
    baseBackoffMs = 1_000,
    maxBackoffMs = 60_000,
    random = Math.random,
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    onIncident = () => {},
    onRecovery = () => {},
  }) {
    if (!Array.isArray(connectors) || connectors.length === 0) {
      throw new TypeError('connectors must be a non-empty array');
    }
    const timingValues = [timeoutMs, baseBackoffMs, maxBackoffMs];
    if (!timingValues.every(Number.isFinite)
      || timeoutMs <= 0
      || baseBackoffMs <= 0
      || maxBackoffMs < baseBackoffMs) {
      throw new RangeError('timeout and backoff values must be finite, positive, and ordered');
    }

    this.options = { timeoutMs, baseBackoffMs, maxBackoffMs, random, now, setTimer, clearTimer, onIncident, onRecovery };
    this.connectors = new Map();
    this.timers = new Map();
    this.running = new Set();
    this.started = false;

    for (const connector of connectors) {
      if (!connector || typeof connector.name !== 'string' || typeof connector.check !== 'function') {
        throw new TypeError('each connector needs a name and a read-only check function');
      }
      if (this.connectors.has(connector.name)) throw new Error(`duplicate connector: ${connector.name}`);
      this.connectors.set(connector.name, {
        check: connector.check,
        state: { status: 'unknown', checkedAt: null, latencyMs: null, failures: 0, nextCheckAt: null },
      });
    }
  }

  // This schedules work rather than awaiting it, so optional integrations can
  // never delay core startup.
  start() {
    if (this.started) return;
    this.started = true;
    for (const name of this.connectors.keys()) this.#schedule(name, 0);
  }

  stop() {
    this.started = false;
    for (const timer of this.timers.values()) this.options.clearTimer(timer);
    this.timers.clear();
  }

  snapshot() {
    const result = {};
    for (const [name, connector] of this.connectors) {
      Object.defineProperty(result, name, {
        value: { ...connector.state },
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  }

  async runNow(name) {
    if (!this.connectors.has(name)) throw new Error(`unknown connector: ${name}`);
    if (this.running.has(name)) return;
    this.running.add(name);
    const connector = this.connectors.get(name);
    const startedAt = this.options.now();
    const previousStatus = connector.state.status;
    let pendingTimedOutProbe = null;

    try {
      await this.#withTimeout(connector.check);
      connector.state = {
        status: 'healthy', checkedAt: this.options.now(), latencyMs: this.options.now() - startedAt,
        failures: 0, nextCheckAt: null,
      };
      if (previousStatus === 'unhealthy') this.#notify(this.options.onRecovery, name);
      this.#schedule(name, this.options.baseBackoffMs);
    } catch (error) {
      const failures = connector.state.failures + 1;
      const delay = this.#backoffDelay(failures);
      pendingTimedOutProbe = error && error.code === 'CONNECTOR_TIMEOUT' ? error.pending : null;
      connector.state = {
        status: 'unhealthy', checkedAt: this.options.now(), latencyMs: this.options.now() - startedAt,
        failures, nextCheckAt: pendingTimedOutProbe ? null : this.options.now() + delay,
      };
      // An incident is emitted only once per contiguous failure period. Error
      // objects are deliberately not stored or passed to callbacks: they may
      // contain URLs, headers, or other credential material.
      if (previousStatus !== 'unhealthy') this.#notify(this.options.onIncident, name);
      if (pendingTimedOutProbe) {
        // Some clients ignore AbortSignal. Keep this connector marked in-flight
        // until the abandoned operation actually settles, so retries cannot
        // accumulate unbounded live requests.
        pendingTimedOutProbe.then(() => {
          this.running.delete(name);
          this.#schedule(name, delay);
        });
      } else {
        this.#schedule(name, delay);
      }
    } finally {
      if (!pendingTimedOutProbe) this.running.delete(name);
    }
  }

  #backoffDelay(failures) {
    const cap = Math.min(this.options.maxBackoffMs, this.options.baseBackoffMs * (2 ** (failures - 1)));
    const sample = Number(this.options.random());
    const boundedSample = Number.isFinite(sample)
      ? Math.min(Math.max(sample, 0), 1 - Number.EPSILON)
      : 0;
    return Math.floor(boundedSample * (cap + 1)); // full jitter, bounded by cap
  }

  #schedule(name, delay) {
    if (!this.started) return;
    const oldTimer = this.timers.get(name);
    if (oldTimer) this.options.clearTimer(oldTimer);
    this.timers.set(name, this.options.setTimer(() => {
      this.timers.delete(name);
      void this.runNow(name);
    }, delay));
  }

  #notify(callback, name) {
    try {
      Promise.resolve(callback({ connector: name })).catch(() => {});
    } catch (_) {
      // Alert delivery must not change the cached health result or retry loop.
    }
  }

  async #withTimeout(check) {
    const controller = new AbortController();
    let timer;
    const settled = Promise.resolve()
      .then(() => check({ readOnly: true, signal: controller.signal }))
      .then(
        () => ({ outcome: 'healthy' }),
        () => ({ outcome: 'unhealthy' }),
      );
    const timeout = new Promise((resolve) => {
      timer = this.options.setTimer(() => {
        controller.abort();
        resolve({ outcome: 'timeout' });
      }, this.options.timeoutMs);
    });

    const result = await Promise.race([settled, timeout]);
    if (timer) this.options.clearTimer(timer);
    if (result.outcome === 'healthy') return;
    if (result.outcome === 'timeout') {
      const error = new Error('connector health check timed out');
      error.code = 'CONNECTOR_TIMEOUT';
      error.pending = settled;
      throw error;
    }
    throw new Error('connector health check failed');
  }
}

/** Create standard adapters; each supplied probe must perform a read-only API call. */
function standardConnectors(probes) {
  return ['linear', 'github', 'dropbox', 'hubspot', 'slack'].map((name) => {
    if (typeof probes[name] !== 'function') throw new TypeError(`missing ${name} read-only probe`);
    return { name, check: probes[name] };
  });
}

module.exports = { ConnectorHealthMonitor, standardConnectors };
