import { scrypt as scryptCallback, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 32;

export async function hashSecret(secret) {
  const salt = randomBytes(16);
  const key = await scrypt(secret, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifySecret(secret, stored) {
  const [scheme, saltHex, keyHex] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex || typeof secret !== "string") return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(secret, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

export function passwordProblem(password) {
  if (typeof password !== "string" || password.length < 10) return "Пароль має містити щонайменше 10 символів.";
  if (password.length > 128) return "Пароль завеликий (до 128 символів).";
  if (!/[a-zа-яіїєґ]/i.test(password) || !/\d/.test(password)) return "Пароль має містити літери та цифри.";
  return null;
}

export function generateTemporaryPassword() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const pick = (set) => set[randomInt(set.length)];
  const chars = [...Array.from({ length: 8 }, () => pick(letters)), ...Array.from({ length: 4 }, () => pick(digits))];
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}
