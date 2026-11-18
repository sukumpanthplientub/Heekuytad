// Coalesce public health probes so monitoring cannot exhaust the database pool.
export function createReadinessCheck(probe, { ttlMs = 5000, now = Date.now } = {}) {
  let pending;
  let healthy = false;
  let expiresAt = 0;
  return async () => {
    if (pending) return pending;
    if (now() < expiresAt) return healthy;
    pending = Promise.resolve()
      .then(probe)
      .then(
        () => {
          healthy = true;
          return true;
        },
        () => {
          healthy = false;
          return false;
        },
      )
      .finally(() => {
        expiresAt = now() + ttlMs;
        pending = undefined;
      });
    return pending;
  };
}
