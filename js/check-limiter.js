// No timers or retries: coalesce event-driven checks and cap their frequency.
export function createCheckLimiter(check, interval = 30000, now = Date.now) {
  let pending = null, last = -Infinity;
  return {
    markChecked() { last = now(); },
    run() {
      if (pending) return pending;
      if (now() - last < interval) return Promise.resolve();
      last = now();
      pending = Promise.resolve().then(check).finally(() => { pending = null; });
      return pending;
    }
  };
}

