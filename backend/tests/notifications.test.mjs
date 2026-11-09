import test, { after } from "node:test";
import assert from "node:assert/strict";
import { freshClient, baseUrl, closeTests, deps } from "./helpers.mjs";
import { createRedisBus } from "../src/services/notificationBus.js";

after(closeTests);

async function openStream(userId) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/notifications/stream`, {
    headers: { "x-demo-user": String(userId) },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next(eventName, timeout = 3000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const match = buffer.match(new RegExp(`event: ${eventName}\\ndata: (.*)\\n\\n`));
        if (match) {
          buffer = buffer.slice(buffer.indexOf(match[0]) + match[0].length);
          return JSON.parse(match[1]);
        }
        const chunk = await Promise.race([reader.read(), new Promise((resolve) => setTimeout(() => resolve(null), 200))]);
        if (chunk?.value) buffer += decoder.decode(chunk.value);
      }
      return null;
    },
    close: () => controller.abort(),
  };
}

test("Нова оцінка миттєво надходить студенту через потік сповіщень", async () => {
  const call = await freshClient();
  const stream = await openStream(3);
  try {
    assert.equal((await stream.next("ready")).source, deps.bus.kind);
    assert.equal((await call("/grades", "POST", { lesson_id: 12, student_id: 3, value: 85 }, 7)).status, 201);
    const received = await stream.next("notification");
    assert.ok(received, "сповіщення не надійшло");
    assert.equal(received.user_id, 3);
    assert.match(received.message, /оцінку 85/);
  } finally {
    stream.close();
  }
});

test("Сповіщення отримує лише адресат", async () => {
  const call = await freshClient();
  const other = await openStream(2);
  try {
    await other.next("ready");
    await call("/grades", "POST", { lesson_id: 12, student_id: 3, value: 85 }, 7);
    assert.equal(await other.next("notification", 800), null);
  } finally {
    other.close();
  }
});

test("Лічильник непрочитаних зростає при новому сповіщенні й скидається після прочитання", async () => {
  const call = await freshClient();
  const before = (await call("/notifications/unread", "GET", null, 3)).data.unread;
  await call("/grades", "POST", { lesson_id: 12, student_id: 3, value: 85 }, 7);
  const after = (await call("/notifications/unread", "GET", null, 3)).data.unread;
  assert.equal(after, before + 1);
  const list = (await call("/bootstrap", "GET", null, 3)).data.notifications.filter((item) => !item.is_read);
  assert.equal(list.length, after);
  assert.equal((await call(`/notifications/${list[0].notification_id}`, "PATCH", {}, 3)).status, 200);
  assert.equal((await call("/notifications/unread", "GET", null, 3)).data.unread, after - 1);
});

test("Redis: публікація, підписка та лічильник працюють між клієнтами", async (t) => {
  let bus;
  try {
    bus = await createRedisBus(process.env.REDIS_URL || "redis://127.0.0.1:6380", { warn() {} });
  } catch {
    t.skip("Redis недоступний");
    return;
  }
  try {
    const userId = 987654;
    await bus.invalidate(userId);
    assert.equal(await bus.unread(userId, async () => 2), 2);
    const received = new Promise((resolve) => bus.subscribe(userId, resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await bus.publish(userId, { message: "Перевірка Redis" });
    assert.equal((await received).message, "Перевірка Redis");
    assert.equal(await bus.unread(userId, async () => 0), 3);
    await bus.invalidate(userId);
  } finally {
    await bus.close();
  }
});

test("Усі сповіщення можна позначити прочитаними одним запитом", async () => {
  const call = await freshClient();
  await call("/grades", "POST", { lesson_id: 12, student_id: 3, value: 85 }, 7);
  assert.ok((await call("/notifications/unread", "GET", null, 3)).data.unread >= 1);
  const result = await call("/notifications/read-all", "POST", {}, 3);
  assert.equal(result.status, 200);
  assert.ok(result.data.updated >= 1);
  assert.equal((await call("/notifications/unread", "GET", null, 3)).data.unread, 0);
});
