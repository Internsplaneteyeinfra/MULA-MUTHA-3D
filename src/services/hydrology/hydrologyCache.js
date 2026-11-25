/**
 * Simple TTL cache for NadiTwin / hydrology fetches.
 */

export function createTtlCache() {
  const map = new Map();

  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      if (Date.now() > hit.expiresAt) {
        map.delete(key);
        return null;
      }
      return hit.value;
    },
    set(key, value, ttlMs) {
      map.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) });
      return value;
    },
    peek(key) {
      return map.get(key)?.value ?? null;
    },
    ageMs(key) {
      const hit = map.get(key);
      if (!hit) return null;
      return Date.now() - (hit.expiresAt - (hit._ttl || 0));
    },
    clear() {
      map.clear();
    },
  };
}
