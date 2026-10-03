import Redis from 'ioredis';
import { ENV, isRedisConfigured } from '../config/env.config';
import { logger } from './logger.service';

export type RedisClient = Redis;

let client: Redis | null = null;
let subscriber: Redis | null = null;
let connecting = false;

/**
 * Redis is optional. When REDIS_URL is missing every helper below degrades to a
 * no-op so the API keeps serving (cache miss, no rate-limit sharing, etc).
 */
export const getRedis = (): Redis | null => {
  if (!isRedisConfigured) return null;
  if (client) return client;

  client = new Redis(ENV.REDIS_URL, {
    keyPrefix: ENV.REDIS_PREFIX,
    maxRetriesPerRequest: 2,
    enableReadyCheck: false,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });

  client.on('error', (err) => logger.error({ err: err?.message }, '[redis] connection error'));
  client.on('connect', () => logger.info('[redis] connected'));

  return client;
};

export const getRedisSubscriber = (): Redis | null => {
  if (!isRedisConfigured) return null;
  if (subscriber) return subscriber;

  subscriber = new Redis(ENV.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  subscriber.on('error', (err) => logger.error({ err: err?.message }, '[redis-sub] error'));
  return subscriber;
};

export const cacheGet = async <T>(key: string): Promise<T | null> => {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export const cacheSet = async (key: string, value: unknown, ttlSec = 300): Promise<void> => {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSec);
  } catch {
    /* cache write failures must never break a request */
  }
};

export const cacheDel = async (...keys: string[]): Promise<void> => {
  const redis = getRedis();
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch {
    /* ignore */
  }
};

export const cacheDelByPattern = async (pattern: string): Promise<void> => {
  const redis = getRedis();
  if (!redis) return;
  try {
    const fullPattern = `${ENV.REDIS_PREFIX}:${pattern}`;
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', fullPattern, 'COUNT', 200);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } catch {
    /* ignore */
  }
};

/** Read-through cache helper. */
export const cacheWrap = async <T>(
  key: string,
  ttlSec: number,
  producer: () => Promise<T>,
): Promise<T> => {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;
  const fresh = await producer();
  await cacheSet(key, fresh, ttlSec);
  return fresh;
};

export const incr = async (key: string, ttlSec?: number): Promise<number> => {
  const redis = getRedis();
  if (!redis) return 0;
  try {
    const value = await redis.incr(key);
    if (ttlSec && value === 1) await redis.expire(key, ttlSec);
    return value;
  } catch {
    return 0;
  }
};

export const incrBy = async (key: string, amount: number, ttlSec?: number): Promise<number> => {
  const redis = getRedis();
  if (!redis) return 0;
  try {
    const value = await redis.incrby(key, amount);
    if (ttlSec && value === amount) await redis.expire(key, ttlSec);
    return value;
  } catch {
    return 0;
  }
};

export const expire = async (key: string, ttlSec: number): Promise<void> => {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.expire(key, ttlSec);
  } catch {
    /* ignore */
  }
};

/** SETNX-based lock used by cron jobs and idempotency guards. */
export const acquireLock = async (key: string, ttlSec: number): Promise<boolean> => {
  const redis = getRedis();
  if (!redis) return true; // no redis -> do not block cron work
  try {
    const result = await redis.set(key, '1', 'EX', ttlSec, 'NX');
    return result === 'OK';
  } catch {
    return false;
  }
};

export const releaseLock = async (key: string): Promise<void> => {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    /* ignore */
  }
};

export const pushToList = async (key: string, value: unknown, maxLen = 100): Promise<void> => {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.lpush(key, JSON.stringify(value));
    await redis.ltrim(key, 0, maxLen - 1);
  } catch {
    /* ignore */
  }
};

export const getList = async <T>(key: string, maxLen = 100): Promise<T[]> => {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.lrange(key, 0, maxLen - 1);
    return raw.map((item) => {
      try {
        return JSON.parse(item) as T;
      } catch {
        return item as unknown as T;
      }
    });
  } catch {
    return [];
  }
};

export const removeFromList = async (key: string, value: unknown): Promise<void> => {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.lrem(key, 0, JSON.stringify(value));
  } catch {
    /* ignore */
  }
};

export const sortedSetAdd = async (key: string, member: string, score: number): Promise<void> => {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.zadd(key, score, member);
  } catch {
    /* ignore */
  }
};

export const sortedSetTop = async (key: string, count = 10): Promise<string[]> => {
  const redis = getRedis();
  if (!redis) return [];
  try {
    return await redis.zrevrange(key, 0, count - 1);
  } catch {
    return [];
  }
};

export const hashSet = async (key: string, field: string, value: unknown): Promise<void> => {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.hset(key, field, JSON.stringify(value));
  } catch {
    /* ignore */
  }
};

export const hashGetAll = async (key: string): Promise<Record<string, any>> => {
  const redis = getRedis();
  if (!redis) return {};
  try {
    const raw = await redis.hgetall(key);
    return Object.entries(raw).reduce<Record<string, any>>((acc, [field, value]) => {
      try {
        acc[field] = JSON.parse(value);
      } catch {
        acc[field] = value;
      }
      return acc;
    }, {});
  } catch {
    return {};
  }
};

export const hashIncrement = async (key: string, field: string, amount = 1): Promise<number> => {
  const redis = getRedis();
  if (!redis) return 0;
  try {
    return await redis.hincrby(key, field, amount);
  } catch {
    return 0;
  }
};

export const isRedisHealthy = async (): Promise<boolean> => {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
};

export const flushCache = async (): Promise<boolean> => {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.flushdb();
    return true;
  } catch {
    return false;
  }
};

export const disconnectRedis = async (): Promise<void> => {
  if (!connecting) connecting = true;
  try {
    if (subscriber) {
      await subscriber.quit();
      subscriber = null;
    }
    if (client) {
      await client.quit();
      client = null;
    }
  } catch {
    try {
      client?.disconnect();
      subscriber?.disconnect();
    } catch {
      /* ignore */
    } finally {
      client = null;
      subscriber = null;
      connecting = false;
    }
  }
};

/** True when REDIS_URL is present. Redis is optional: callers degrade gracefully. */
export const isRedisAvailable = isRedisConfigured;
