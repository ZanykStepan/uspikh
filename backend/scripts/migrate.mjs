import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { config } from "../src/config/index.js";
import { createPool } from "../src/db/pool.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function migrate(pool, { reset = false } = {}) {
  if (reset) await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await pool.query("SELECT name FROM schema_migrations")).rows.map((row) => row.name));
  const applied = [];
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    if (done.has(name)) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(readFileSync(join(dir, name), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
      applied.push(name);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Міграція ${name} не виконана: ${error.message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool(process.env.MIGRATE_TEST_DB ? config.testDatabaseUrl : config.databaseUrl);
  try {
    const applied = await migrate(pool, { reset: process.argv.includes("--reset") });
    console.log(applied.length ? `Застосовано міграції: ${applied.join(", ")}` : "Схема бази даних актуальна.");
  } finally {
    await pool.end();
  }
}
