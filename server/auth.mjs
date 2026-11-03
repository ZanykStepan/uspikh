import { scryptSync, timingSafeEqual } from "node:crypto";

export const DEMO_PASSWORD = "Demo2026!";
export function passwordHash(userId, password = DEMO_PASSWORD) {
  return scryptSync(password, `uspikh-demo-${userId}`, 32).toString("hex");
}
export function checkPassword(user, password) {
  const expected = Buffer.from(user.password_hash || "", "hex");
  if (expected.length !== 32 || typeof password !== "string") return false;
  return timingSafeEqual(expected, scryptSync(password, `uspikh-demo-${user.user_id}`, 32));
}
