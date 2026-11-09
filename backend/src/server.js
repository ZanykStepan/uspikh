import { config } from "./config/index.js";
import { createPool } from "./db/pool.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createBus } from "./services/notificationBus.js";

const pool = createPool(config.databaseUrl);
try {
  await pool.query("SELECT 1");
} catch (error) {
  console.error(`Не вдалося підключитися до PostgreSQL (${error.code || error.message}). Запустіть базу: npm run db:up`);
  process.exit(1);
}
const demoToday = process.env.DEMO_TODAY;
if (demoToday && !/^\d{4}-\d{2}-\d{2}$/.test(demoToday)) {
  console.error("DEMO_TODAY має мати формат РРРР-ММ-ДД, наприклад 2027-07-05.");
  process.exit(1);
}
const dist = fileURLToPath(new URL("../../dist", import.meta.url));
const bus = await createBus(config.redisUrl);
console.log(`Сповіщення: ${bus.kind === "redis" ? "Redis" : "пам’ять процесу (Redis недоступний)"}`);
const app = createApp({ bus, pool, today: demoToday, staticDir: existsSync(dist) ? dist : undefined });
const server = app.listen(config.port, "127.0.0.1", () =>
  console.log(`API «Успіх»: http://127.0.0.1:${config.port}  (документація: /api/docs)`),
);
const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
