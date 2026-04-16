type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type CacheStore = Map<string, CacheEntry<unknown>>;

function getStore(): CacheStore {
  const g = globalThis as typeof globalThis & { __tlCache?: CacheStore };
  if (!g.__tlCache) g.__tlCache = new Map();
  return g.__tlCache;
}

export async function cacheGetOrSet<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const store = getStore();
  const now = Date.now();
  const existing = store.get(key) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > now) return existing.value;

  const value = await fn();
  store.set(key, { value, expiresAt: now + Math.max(0, ttlMs) });
  return value;
}

