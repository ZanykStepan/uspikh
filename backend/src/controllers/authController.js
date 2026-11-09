import { randomBytes } from "node:crypto";
import { config } from "../config/index.js";
import { fail } from "../utils/httpError.js";
import { transactional } from "../middleware/unitOfWork.js";
import * as auth from "../services/authService.js";
import { stateDigest } from "../services/authService.js";

const FLOW_COOKIE = "uspikh_oidc";
const cookieOptions = { httpOnly: true, sameSite: "lax", secure: config.isProd, maxAge: 10 * 60 * 1000, path: "/api/auth/google" };

const readCookie = (req, name) => {
  const pair = String(req.headers.cookie || "")
    .split(/;\s*/)
    .find((item) => item.startsWith(name + "="));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
};

const db = (req) => req.app.locals.deps.pool;

export const options = (req, res) => {
  const { oidc } = req.app.locals.deps;
  res.json({ google: Boolean(oidc?.enabled), reserve: config.reserveLoginEnabled, domains: config.allowedEmailDomains });
};

export const login = async (req, res) => res.json(await auth.loginWithPassword(db(req), req.body ?? {}, req));

export async function logout(req, res) {
  if (req.auth) await auth.revokeSession(db(req), req.auth.jti);
  res.json({ message: "Вихід виконано." });
}

export async function role(req, res) {
  if (!req.auth) fail(403, "Ця роль не призначена вашому обліковому запису.");
  res.json(await auth.switchRole(db(req), req.auth, req.body?.role));
}

export async function security(req, res) {
  if (!req.auth) fail(401, "Профіль недоступний.");
  res.json(await auth.securityStatus(db(req), req.auth));
}

export async function password(req, res) {
  if (!req.auth) fail(401, "Профіль недоступний.");
  res.json(await auth.changePassword(db(req), req.auth, req.body ?? {}));
}

export function googleStart(req, res) {
  const { oidc } = req.app.locals.deps;
  if (!oidc?.enabled) fail(503, "Вхід через Google не налаштовано. Вкажіть GOOGLE_CLIENT_ID і GOOGLE_CLIENT_SECRET.");
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  res.cookie(FLOW_COOKIE, JSON.stringify({ state, nonce, codeVerifier }), cookieOptions);
  res.redirect(oidc.authorizationUrl({ state, nonce, codeChallenge: stateDigest(codeVerifier) }));
}

export async function googleCallback(req, res) {
  const { oidc } = req.app.locals.deps;
  const back = (query) => res.redirect(`${config.frontendUrl}/#/auth/callback?${new URLSearchParams(query)}`);
  res.clearCookie(FLOW_COOKIE, { path: cookieOptions.path });
  let flow;
  try {
    flow = JSON.parse(readCookie(req, FLOW_COOKIE));
  } catch {
    flow = null;
  }
  if (!oidc?.enabled || !flow || typeof req.query.code !== "string" || req.query.state !== flow.state) return back({ error: "state" });
  let profile;
  try {
    profile = await oidc.exchange({ code: req.query.code, codeVerifier: flow.codeVerifier, nonce: flow.nonce });
  } catch {
    return back({ error: "google" });
  }
  const result = await auth.loginWithGoogle(db(req), profile, req);
  if (result.error) return back({ error: result.error });
  back({ token: result.token });
}

const adminOnly = (c) => {
  if (c.actor.role !== "admin") fail(403, "Дія доступна лише адміністратору.");
};
export const issueReservePassword = transactional(async (c) => {
  adminOnly(c);
  return { status: 201, data: await auth.issueReservePassword(c.client, c.actor, c.recordId, c.audit) };
});
export const unlockAccount = transactional(async (c) => {
  adminOnly(c);
  return { status: 200, data: await auth.unlockAccount(c.client, c.actor, c.recordId, c.audit) };
});
export const loginEvents = transactional(
  async (c) => {
    adminOnly(c);
    return { status: 200, data: await auth.listLoginEvents(c.client, Number(c.req.query.limit) || 100) };
  },
  { write: false },
);
