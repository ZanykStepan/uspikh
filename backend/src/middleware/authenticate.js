import { authenticateToken } from "../services/authService.js";

export async function authenticate(req, _res, next) {
  const token = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(String(req.headers.authorization || ""))?.[1];
  const { pool } = req.app.locals.deps;
  req.auth = token ? await authenticateToken(pool, token) : null;
  req.token = token || null;
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.auth && !req.app.locals.deps.allowDemoHeader) return next(Object.assign(new Error("Профіль недоступний."), { status: 401 }));
  next();
}
