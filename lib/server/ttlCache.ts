/**
 * Small bounded LRU cache with per-entry TTL. Map preserves insertion order, so the
 * first key is always the least recently used one. `now` is injectable for tests.
 */
export interface TtlCache<V> {
  get(key: string, now?: number): V | undefined;
  set(key: string, value: V, now?: number): void;
  size(): number;
}

export function createTtlCache<V>({ max, ttlMs }: { max: number; ttlMs: number }): TtlCache<V> {
  const store = new Map<string, { value: V; expires: number }>();
  return {
    get(key, now = Date.now()) {
      const hit = store.get(key);
      if (!hit) return undefined;
      store.delete(key);
      if (hit.expires <= now) return undefined;
      store.set(key, hit); // mark as most recently used
      return hit.value;
    },
    set(key, value, now = Date.now()) {
      store.delete(key);
      store.set(key, { value, expires: now + ttlMs });
      while (store.size > max) store.delete(store.keys().next().value as string);
    },
    size: () => store.size,
  };
}
