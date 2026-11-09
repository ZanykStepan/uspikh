import { EventEmitter } from "node:events";
import { createClient } from "redis";

const channel = (userId) => `notifications:${userId}`;
const counterKey = (userId) => `unread:${userId}`;

export function createMemoryBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const counters = new Map();
  return {
    kind: "memory",
    async publish(userId, notification) {
      if (counters.has(userId)) counters.set(userId, counters.get(userId) + 1);
      emitter.emit(channel(userId), notification);
    },
    async subscribe(userId, handler) {
      emitter.on(channel(userId), handler);
      return () => emitter.off(channel(userId), handler);
    },
    async unread(userId, load) {
      if (!counters.has(userId)) counters.set(userId, await load());
      return counters.get(userId);
    },
    async invalidate(userId) {
      counters.delete(userId);
    },
    async close() {},
  };
}

export async function createRedisBus(url, log = console) {
  const publisher = createClient({ url, socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 2000) } });
  const subscriber = publisher.duplicate();
  for (const client of [publisher, subscriber]) client.on("error", (error) => log.warn?.(`Redis: ${error.message}`));
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("час очікування вичерпано")), 2500).unref());
  try {
    await Promise.race([Promise.all([publisher.connect(), subscriber.connect()]), timeout]);
  } catch (error) {
    publisher.destroy();
    subscriber.destroy();
    throw error;
  }
  const listeners = new Map();
  await subscriber.pSubscribe("notifications:*", (message, name) => {
    const handlers = listeners.get(name);
    if (!handlers) return;
    const payload = JSON.parse(message);
    for (const handler of handlers) handler(payload);
  });
  return {
    kind: "redis",
    async publish(userId, notification) {
      const key = counterKey(userId);
      if (await publisher.exists(key)) await publisher.incr(key);
      await publisher.publish(channel(userId), JSON.stringify(notification));
    },
    async subscribe(userId, handler) {
      const name = channel(userId);
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
      return () => {
        listeners.get(name)?.delete(handler);
        if (!listeners.get(name)?.size) listeners.delete(name);
      };
    },
    async unread(userId, load) {
      const cached = await publisher.get(counterKey(userId));
      if (cached !== null) return Number(cached);
      const value = await load();
      await publisher.set(counterKey(userId), value, { EX: 3600 });
      return value;
    },
    async invalidate(userId) {
      await publisher.del(counterKey(userId));
    },
    async close() {
      await subscriber.quit().catch(() => {});
      await publisher.quit().catch(() => {});
    },
  };
}

export async function createBus(url, log = console) {
  if (!url) return createMemoryBus();
  try {
    return await createRedisBus(url, log);
  } catch (error) {
    log.warn?.(`Redis недоступний (${error.message}); сповіщення працюватимуть без Redis у межах одного процесу.`);
    return createMemoryBus();
  }
}
