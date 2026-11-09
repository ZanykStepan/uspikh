import { fail } from "../utils/httpError.js";

const currentUserId = (req) => {
  const { allowDemoHeader } = req.app.locals.deps;
  return req.auth?.userId ?? (allowDemoHeader ? Number(req.headers["x-demo-user"] || 1) : null);
};

export async function unread(req, res) {
  const { pool, bus } = req.app.locals.deps;
  const userId = currentUserId(req);
  if (!userId) fail(401, "Профіль недоступний.");
  const count = await bus.unread(userId, async () => {
    const { rows } = await pool.query("SELECT count(*)::int AS total FROM notifications WHERE user_id = $1 AND NOT is_read", [userId]);
    return rows[0].total;
  });
  res.json({ unread: count, source: bus.kind });
}

export async function stream(req, res) {
  const { bus } = req.app.locals.deps;
  const userId = currentUserId(req);
  if (!userId) fail(401, "Профіль недоступний.");
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ source: bus.kind })}\n\n`);
  const unsubscribe = await bus.subscribe(userId, (notification) => {
    res.write(`event: notification\ndata: ${JSON.stringify(notification)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
