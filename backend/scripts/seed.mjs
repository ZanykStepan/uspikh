import { fileURLToPath } from "node:url";
import { config } from "../src/config/index.js";
import { createPool } from "../src/db/pool.js";
import { replaceAll } from "../src/repositories/unitOfWork.js";
import { seed, DEMO_PASSWORD } from "../src/seed/data.js";
import { hashSecret } from "../src/utils/passwords.js";

export async function seedDatabase(pool, { password = DEMO_PASSWORD, data = seed() } = {}) {
  await replaceAll(pool, data);
  const { rows } = await pool.query("SELECT user_id FROM users");
  for (const { user_id } of rows) {
    await pool.query("UPDATE users SET password_hash = $2, password_changed_at = now() WHERE user_id = $1", [
      user_id,
      await hashSecret(password),
    ]);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool(config.databaseUrl);
  try {
    await seedDatabase(pool);
    const { rows } = await pool.query(
      "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM lessons) AS lessons, (SELECT count(*) FROM grades) AS grades",
    );
    console.log(`Демонстраційні дані завантажено: користувачів ${rows[0].users}, занять ${rows[0].lessons}, оцінок ${rows[0].grades}.`);
  } finally {
    await pool.end();
  }
}
