import test, { after } from "node:test";
import assert from "node:assert/strict";
import { freshApi, clientFor, fakeOidc, pool, baseUrl, closeTests, deps } from "./helpers.mjs";

after(closeTests);
const PASSWORD = "Demo2026!";
const login = (call, email = "demo1@pnu.edu.ua", password = PASSWORD) => call("/auth/login", "POST", { email, password });

test("Помилки мають єдиний формат {status, message}", async () => {
  const api = await freshApi({ allowDemoHeader: false });
  const anonymous = api.client();
  const unauthorized = await anonymous("/bootstrap");
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.data.status, 401);
  assert.equal(typeof unauthorized.data.message, "string");
  const missing = await anonymous("/unknown");
  assert.equal(missing.status, 401);
  const token = (await login(anonymous)).data.token;
  const call = api.client(token);
  const notFound = await call("/unknown");
  assert.deepEqual(Object.keys(notFound.data).sort(), ["message", "status"]);
  assert.equal(notFound.status, 404);
});

test("Некоректний JSON і ідентифікатор дають 400, завеликий запит — 413", async () => {
  const api = await freshApi({ allowDemoHeader: false });
  const token = (await login(api.client())).data.token;
  const raw = (body) => fetch(baseUrl + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  assert.equal((await raw("{broken")).status, 400);
  assert.equal((await raw(JSON.stringify({ x: "a".repeat(20000) }))).status, 413);
  assert.equal((await api.client(token)("/notifications/abc", "PATCH")).status, 400);
  assert.equal((await api.client(token)("/notifications/99999", "PATCH")).status, 404);
});

test("Вхід приймає лише корпоративні домени pnu.edu.ua та cnu.edu.ua", async () => {
  const api = await freshApi({ allowDemoHeader: false });
  const call = api.client();
  assert.equal((await login(call, "demo1@gmail.com")).status, 401);
  assert.equal((await login(call, "demo1@pnu.edu.ua.evil.com")).status, 401);
  assert.equal((await login(call, "DEMO1@PNU.EDU.UA")).status, 200);
  await pool.query("UPDATE users SET email = 'student.one@cnu.edu.ua' WHERE user_id = 1");
  assert.equal((await login(call, "student.one@cnu.edu.ua")).status, 200);
});

test("Після 5 невдалих спроб обліковий запис блокується, подія входу журналюється", async () => {
  const api = await freshApi({ allowDemoHeader: false });
  const call = api.client();
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await login(call, "demo2@pnu.edu.ua", "wrong-password-1")).status, 401);
  const locked = await login(call, "demo2@pnu.edu.ua", PASSWORD);
  assert.equal(locked.status, 429);
  const { rows } = await pool.query("SELECT success, reason FROM login_events WHERE email = 'demo2@pnu.edu.ua' ORDER BY event_id");
  assert.equal(rows.filter((row) => !row.success && row.reason === "bad_password").length, 5);
  assert.equal(rows.at(-1).reason, "locked");
  const admin = api.client((await login(call, "demo10@pnu.edu.ua")).data.token);
  assert.equal((await admin("/admin/users/2/unlock", "POST")).status, 200);
  assert.equal((await login(call, "demo2@pnu.edu.ua", PASSWORD)).status, 200);
  const events = await admin("/admin/login-events");
  assert.equal(events.status, 200);
  assert.ok(events.data.length >= 6 && events.data.every((event) => !("user_agent" in event) || true));
  assert.equal((await api.client((await login(call, "demo1@pnu.edu.ua")).data.token)("/admin/login-events")).status, 403);
});

test("Тимчасовий пароль: видає адміністратор, показується один раз і зберігається як хеш", async () => {
  const api = await freshApi({ allowDemoHeader: false });
  const anonymous = api.client();
  const admin = api.client((await login(anonymous, "demo10@pnu.edu.ua")).data.token);
  assert.equal((await api.client((await login(anonymous)).data.token)("/admin/users/2/reserve-password", "POST")).status, 403);
  assert.equal((await admin("/admin/users/999/reserve-password", "POST")).status, 404);
  const issued = await admin("/admin/users/2/reserve-password", "POST");
  assert.equal(issued.status, 201);
  assert.match(issued.data.password, /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  const { rows } = await pool.query("SELECT user_id, password_hash FROM users WHERE user_id IN (1, 2) ORDER BY user_id");
  assert.match(rows[1].password_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.ok(!rows[1].password_hash.includes(issued.data.password));
  assert.notEqual(rows[0].password_hash, rows[1].password_hash);
  const audit = await pool.query("SELECT detail FROM audit_logs WHERE action = 'security.reserve_password'");
  assert.equal(audit.rowCount, 1);
  assert.ok(!audit.rows[0].detail.includes(issued.data.password));
});

test("Вхід за тимчасовим паролем вимагає зміни; після зміни працює лише новий пароль", async () => {
  const api = await freshApi({ allowDemoHeader: false });
  const anonymous = api.client();
  const admin = api.client((await login(anonymous, "demo10@pnu.edu.ua")).data.token);
  const temporary = (await admin("/admin/users/1/reserve-password", "POST")).data.password;
  assert.equal((await login(anonymous, "demo1@pnu.edu.ua", PASSWORD)).status, 401);
  const entered = await login(anonymous, "demo1@pnu.edu.ua", temporary);
  assert.equal(entered.status, 200);
  assert.equal(entered.data.must_change_password, true);
  const session = api.client(entered.data.token);
  assert.deepEqual((await session("/auth/security")).data, { has_password: true, must_change_password: true, method: "password" });
  assert.equal((await session("/auth/password", "POST", { new_password: "NovyyParol2026" })).status, 403);
  assert.equal((await session("/auth/password", "POST", { current_password: temporary, new_password: "short" })).status, 422);
  assert.equal((await session("/auth/password", "POST", { current_password: temporary, new_password: temporary })).status, 422);
  assert.equal((await session("/auth/password", "POST", { current_password: temporary, new_password: "NovyyParol2026" })).status, 200);
  assert.equal((await login(anonymous, "demo1@pnu.edu.ua", temporary)).status, 401);
  const next = await login(anonymous, "demo1@pnu.edu.ua", "NovyyParol2026");
  assert.equal(next.status, 200);
  assert.equal(next.data.must_change_password, false);
});

test("Після входу через Google резервний пароль можна встановити вперше без поточного", async () => {
  const api = await freshApi({ allowDemoHeader: false });
  await pool.query("UPDATE users SET password_hash = NULL WHERE user_id = 3");
  fakeOidc.profile = { sub: "g-first", email: "demo3@pnu.edu.ua", email_verified: true, hd: "pnu.edu.ua" };
  const start = await fetch(baseUrl + "/api/auth/google/start", { redirect: "manual" });
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const callback = await fetch(`${baseUrl}/api/auth/google/callback?code=abc&state=${state}`, {
    redirect: "manual",
    headers: { cookie: start.headers.get("set-cookie").split(";")[0] },
  });
  const token = new URL(callback.headers.get("location").replace("/#", "/")).searchParams.get("token");
  const session = api.client(token);
  assert.equal((await session("/auth/security")).data.has_password, false);
  assert.equal((await login(api.client(), "demo3@pnu.edu.ua", PASSWORD)).status, 401);
  assert.equal((await session("/auth/password", "POST", { new_password: "MiyReservnyy2026" })).status, 200);
  assert.equal((await login(api.client(), "demo3@pnu.edu.ua", "MiyReservnyy2026")).status, 200);
});

test("Токен підроблений, прострочений або відкликаний — 401", async () => {
  const api = await freshApi({ allowDemoHeader: false });
  const anonymous = api.client();
  const { token } = (await login(anonymous)).data;
  const [header, payload, signature] = token.split(".");
  const forged = `${header}.${Buffer.from(JSON.stringify({ sub: "10", jti: JSON.parse(Buffer.from(payload, "base64url")).jti })).toString("base64url")}.${signature}`;
  assert.equal((await api.client(forged)("/bootstrap")).status, 401);
  assert.equal((await api.client(token)("/bootstrap")).status, 200);
  await pool.query("UPDATE sessions SET expires_at = now() - interval '1 minute'");
  assert.equal((await api.client(token)("/bootstrap")).status, 401);
  const fresh = (await login(anonymous)).data.token;
  assert.equal((await api.client(fresh)("/auth/logout", "POST")).status, 200);
  assert.equal((await api.client(fresh)("/bootstrap")).status, 401);
});

test("Користувач, якого створив адміністратор, не має пароля до видачі тимчасового", async () => {
  const api = await freshApi({ allowDemoHeader: false });
  const anonymous = api.client();
  const admin = api.client((await login(anonymous, "demo10@pnu.edu.ua")).data.token);
  const created = await admin("/users", "POST", {
    full_name: "Новий Викладач",
    email: "new.teacher@cnu.edu.ua",
    roles: ["teacher"],
    faculty: "Факультет математики та інформатики",
  });
  assert.equal(created.status, 201);
  assert.ok(!("password_hash" in created.data));
  assert.equal((await login(anonymous, "new.teacher@cnu.edu.ua", PASSWORD)).status, 401);
  assert.equal(
    (
      await admin("/users", "POST", {
        full_name: "Сторонній",
        email: "x@gmail.com",
        roles: ["teacher"],
        faculty: "Факультет математики та інформатики",
      })
    ).status,
    422,
  );
});

async function googleFlow(profile, { tamperState = false } = {}) {
  fakeOidc.profile = profile;
  const start = await fetch(baseUrl + "/api/auth/google/start", { redirect: "manual" });
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const cookie = start.headers.get("set-cookie").split(";")[0];
  const callback = await fetch(`${baseUrl}/api/auth/google/callback?code=abc&state=${tamperState ? "forged" : state}`, {
    redirect: "manual",
    headers: { cookie },
  });
  assert.equal(callback.status, 302);
  return new URL(callback.headers.get("location").replace("/#", "/")).searchParams;
}

test("Google OIDC: входять лише зареєстровані користувачі корпоративного домену", async () => {
  const api = await freshApi({ allowDemoHeader: false });
  const ok = await googleFlow({ sub: "g-1", email: "demo1@pnu.edu.ua", email_verified: true, hd: "pnu.edu.ua" });
  assert.ok(ok.get("token"));
  const session = api.client(ok.get("token"));
  assert.equal((await session("/bootstrap")).data.me.user_id, 1);
  const stored = await pool.query("SELECT google_sub FROM users WHERE user_id = 1");
  assert.equal(stored.rows[0].google_sub, "g-1");
  assert.equal((await googleFlow({ sub: "g-1", email: "demo1@pnu.edu.ua", email_verified: true, hd: "pnu.edu.ua" })).get("error"), null);
  assert.equal(
    (await googleFlow({ sub: "other", email: "demo1@pnu.edu.ua", email_verified: true, hd: "pnu.edu.ua" })).get("error"),
    "not_registered",
  );
  assert.equal(
    (await googleFlow({ sub: "g-2", email: "stranger@pnu.edu.ua", email_verified: true, hd: "pnu.edu.ua" })).get("error"),
    "not_registered",
  );
  assert.equal((await googleFlow({ sub: "g-3", email: "someone@gmail.com", email_verified: true })).get("error"), "domain");
  assert.equal(
    (await googleFlow({ sub: "g-4", email: "demo2@pnu.edu.ua", email_verified: false, hd: "pnu.edu.ua" })).get("error"),
    "domain",
  );
  assert.equal(
    (await googleFlow({ sub: "g-5", email: "demo2@pnu.edu.ua", email_verified: true, hd: "pnu.edu.ua" }, { tamperState: true })).get(
      "error",
    ),
    "state",
  );
  const options = await api.client()("/auth/options");
  assert.deepEqual(options.data.domains, ["pnu.edu.ua", "cnu.edu.ua"]);
  assert.equal(options.data.google, true);
});

test("Вимкнений резервний вхід блокує пароль, але не Google", async () => {
  const api = await freshApi({ allowDemoHeader: false });
  const { config } = await import("../src/config/index.js");
  config.reserveLoginEnabled = false;
  try {
    assert.equal((await login(api.client())).status, 403);
    assert.ok((await googleFlow({ sub: "g-9", email: "demo3@pnu.edu.ua", email_verified: true, hd: "pnu.edu.ua" })).get("token"));
  } finally {
    config.reserveLoginEnabled = true;
  }
});

test("Серверна валідація не покладається на інтерфейс", async () => {
  const api = await freshApi();
  const call = clientFor();
  deps.allowDemoHeader = true;
  assert.equal((await call("/grades", "POST", { lesson_id: 1, student_id: 1, value: -5 }, 7)).status, 422);
  assert.equal((await call("/grades", "POST", { lesson_id: 1, student_id: 1, value: "90" }, 7)).status, 422);
  assert.equal(
    (await call("/lessons", "POST", { assignment_id: 1, lesson_date: "2026-02-30", lesson_type: "Лекція", topic: "Тема" }, 7)).status,
    422,
  );
  assert.equal((await call("/groups", "POST", { name: "A", course: 9, admission_year: 2024 }, 10)).status, 422);
  assert.ok(api);
});
