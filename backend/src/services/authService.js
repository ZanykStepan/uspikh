import { randomUUID, randomBytes, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { fail } from "../utils/httpError.js";
import { hashSecret, verifySecret, passwordProblem, generateTemporaryPassword } from "../utils/passwords.js";

const BAD_CREDENTIALS = "Невірна університетська пошта або пароль.";
const TOO_MANY = "Забагато невдалих спроб. Обліковий запис тимчасово заблоковано, спробуйте пізніше.";
const dummyHash = await hashSecret(randomBytes(8).toString("hex"));

export const normalizeEmail = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
export const isCorporateEmail = (email) => /^[^\s@]+@[^\s@]+$/.test(email) && config.allowedEmailDomains.includes(email.split("@")[1]);

const publicUser = (row) => ({ user_id: row.user_id, full_name: row.full_name, role: row.role, roles: row.roles, email: row.email });

export async function findAccount(db, where, value) {
  const { rows } = await db.query(
    `SELECT u.*, COALESCE((SELECT array_agg(r.role ORDER BY r.position) FROM user_roles r WHERE r.user_id = u.user_id), ARRAY[u.role]) AS roles
       FROM users u WHERE ${where}`,
    [value],
  );
  return rows[0] || null;
}

const loginAllowed = (account) => account && ["active", "graduated"].includes(account.status);

export async function logEvent(db, { userId = null, email = null, method, success, reason = null, req }) {
  await db.query("INSERT INTO login_events (user_id, email, method, success, reason, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
    userId,
    email?.slice(0, 254) ?? null,
    method,
    success,
    reason,
    req?.ip ?? null,
    String(req?.headers?.["user-agent"] || "").slice(0, 300) || null,
  ]);
}

export async function issueSession(db, account, { method, role = account.role }) {
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + config.jwtTtlHours * 3600_000);
  await db.query("INSERT INTO sessions (jti, user_id, role, method, expires_at) VALUES ($1,$2,$3,$4,$5)", [
    jti,
    account.user_id,
    role,
    method,
    expiresAt,
  ]);
  const token = jwt.sign({ sub: String(account.user_id), jti }, config.jwtSecret, {
    algorithm: "HS256",
    expiresIn: `${config.jwtTtlHours}h`,
  });
  return { token, user: publicUser({ ...account, role }) };
}

async function registerFailure(db, account) {
  const attempts = account.failed_attempts + 1;
  if (attempts >= config.maxFailedAttempts) {
    await db.query("UPDATE users SET failed_attempts = 0, locked_until = now() + make_interval(mins => $2) WHERE user_id = $1", [
      account.user_id,
      config.lockMinutes,
    ]);
  } else {
    await db.query("UPDATE users SET failed_attempts = $2 WHERE user_id = $1", [account.user_id, attempts]);
  }
}

const isLocked = (account) => account?.locked_until && new Date(account.locked_until) > new Date();

export async function loginWithPassword(db, { email, password }, req) {
  if (!config.reserveLoginEnabled) fail(403, "Резервний вхід вимкнено. Скористайтеся входом через Google.");
  const address = normalizeEmail(email);
  const account = isCorporateEmail(address) ? await findAccount(db, "u.email = $1", address) : null;
  if (isLocked(account)) {
    await logEvent(db, { userId: account.user_id, email: address, method: "password", success: false, reason: "locked", req });
    fail(429, TOO_MANY);
  }
  const valid = await verifySecret(typeof password === "string" ? password : "", account?.password_hash || dummyHash);
  if (!account || !loginAllowed(account) || !account.password_hash || !valid) {
    if (account) await registerFailure(db, account);
    await logEvent(db, {
      userId: account?.user_id ?? null,
      email: address,
      method: "password",
      success: false,
      reason: account ? "bad_password" : "unknown_user",
      req,
    });
    fail(401, BAD_CREDENTIALS);
  }
  await db.query("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1", [account.user_id]);
  await logEvent(db, { userId: account.user_id, email: address, method: "password", success: true, req });
  return { ...(await issueSession(db, account, { method: "password" })), must_change_password: account.must_change_password };
}

export async function authenticateToken(db, token) {
  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
  } catch {
    return null;
  }
  const { rows } = await db.query(
    "SELECT user_id, role, method, jti FROM sessions WHERE jti = $1 AND revoked_at IS NULL AND expires_at > now()",
    [claims.jti],
  );
  return rows[0] ? { userId: rows[0].user_id, role: rows[0].role, method: rows[0].method, jti: rows[0].jti } : null;
}

export async function revokeSession(db, jti) {
  await db.query("UPDATE sessions SET revoked_at = now() WHERE jti = $1", [jti]);
}

export async function switchRole(db, auth, selected) {
  const account = await findAccount(db, "u.user_id = $1", auth.userId);
  if (
    !account ||
    typeof selected !== "string" ||
    !account.roles.includes(selected) ||
    (account.status === "graduated" && selected !== "student")
  ) {
    fail(403, "Ця роль не призначена вашому обліковому запису.");
  }
  await db.query("UPDATE sessions SET role = $2 WHERE jti = $1", [auth.jti, selected]);
  return { role: selected, roles: account.roles };
}

export async function changePassword(db, auth, { current_password, new_password }) {
  const problem = passwordProblem(new_password);
  if (problem) fail(422, problem);
  const account = await findAccount(db, "u.user_id = $1", auth.userId);
  if (!account) fail(401, "Профіль недоступний.");
  if (account.password_hash && !(await verifySecret(typeof current_password === "string" ? current_password : "", account.password_hash))) {
    fail(403, "Поточний пароль введено неправильно.");
  }
  if (account.password_hash && (await verifySecret(new_password, account.password_hash)))
    fail(422, "Новий пароль має відрізнятися від поточного.");
  await db.query("UPDATE users SET password_hash = $2, password_changed_at = now(), must_change_password = false WHERE user_id = $1", [
    account.user_id,
    await hashSecret(new_password),
  ]);
  await db.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND jti <> $2 AND revoked_at IS NULL", [
    account.user_id,
    auth.jti,
  ]);
  return { message: "Резервний пароль збережено." };
}

export async function securityStatus(db, auth) {
  const account = await findAccount(db, "u.user_id = $1", auth.userId);
  return {
    has_password: Boolean(account?.password_hash),
    must_change_password: Boolean(account?.must_change_password),
    method: auth.method,
  };
}

export async function issueReservePassword(db, actor, userId, audit) {
  const account = await findAccount(db, "u.user_id = $1", userId);
  if (!account) fail(404, "Користувача не знайдено.");
  const password = generateTemporaryPassword();
  await db.query(
    "UPDATE users SET password_hash = $2, password_changed_at = now(), must_change_password = true, failed_attempts = 0, locked_until = NULL WHERE user_id = $1",
    [userId, await hashSecret(password)],
  );
  await db.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
  audit(actor, "security.reserve_password", `user:${userId}`, "Видано тимчасовий резервний пароль");
  return {
    user_id: userId,
    email: account.email,
    password,
    message: "Передайте пароль користувачу. Повторно він не показується; при першому вході його потрібно змінити.",
  };
}

export async function unlockAccount(db, actor, userId, audit) {
  const account = await findAccount(db, "u.user_id = $1", userId);
  if (!account) fail(404, "Користувача не знайдено.");
  await db.query("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1", [userId]);
  audit(actor, "security.unlock", `user:${userId}`, "Блокування знято");
  return { message: "Обліковий запис розблоковано." };
}

export async function listLoginEvents(db, limit = 100) {
  const { rows } = await db.query(
    "SELECT event_id, user_id, email, method, success, reason, ip, at FROM login_events ORDER BY event_id DESC LIMIT $1",
    [Math.min(Math.max(limit, 1), 500)],
  );
  return rows;
}

export const stateDigest = (value) => createHash("sha256").update(value).digest("base64url");

export async function loginWithGoogle(db, profile, req) {
  const address = normalizeEmail(profile.email);
  const domainOk = isCorporateEmail(address) && (!profile.hd || config.allowedEmailDomains.includes(String(profile.hd).toLowerCase()));
  if (!profile.email_verified || !domainOk) {
    await logEvent(db, { email: address, method: "google", success: false, reason: "domain_denied", req });
    return { error: "domain" };
  }
  const account = await findAccount(db, "u.email = $1", address);
  if (!loginAllowed(account)) {
    await logEvent(db, {
      userId: account?.user_id ?? null,
      email: address,
      method: "google",
      success: false,
      reason: "not_registered",
      req,
    });
    return { error: "not_registered" };
  }
  if (account.google_sub && account.google_sub !== profile.sub) {
    await logEvent(db, { userId: account.user_id, email: address, method: "google", success: false, reason: "sub_mismatch", req });
    return { error: "not_registered" };
  }
  if (!account.google_sub) await db.query("UPDATE users SET google_sub = $2 WHERE user_id = $1", [account.user_id, profile.sub]);
  await logEvent(db, { userId: account.user_id, email: address, method: "google", success: true, req });
  return issueSession(db, account, { method: "google" });
}
