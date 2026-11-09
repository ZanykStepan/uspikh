import { ENTITIES, valueFor } from "./mapping.js";

const fingerprint = (entity, row) =>
  JSON.stringify([entity.columns.map((column) => valueFor(entity, column, row)), (entity.links || []).map((link) => link.write(row))]);

const WRITE_LOCK = 8_100_001;

async function loadEntity(client, entity) {
  const { rows } = await client.query(`SELECT ${entity.columns.join(", ")} FROM ${entity.name} ORDER BY ${entity.pk}`);
  const links = [];
  for (const link of entity.links || []) {
    const order = link.columns.includes("position") ? `${link.fk}, position` : link.fk;
    const result = await client.query(`SELECT ${link.fk}, ${link.columns.join(", ")} FROM ${link.table} ORDER BY ${order}`);
    const grouped = new Map();
    for (const item of result.rows) {
      if (!grouped.has(item[link.fk])) grouped.set(item[link.fk], []);
      grouped.get(item[link.fk]).push(item);
    }
    links.push([link, grouped]);
  }
  for (const row of rows) for (const [link, grouped] of links) link.read(grouped.get(row[entity.pk]) || [], row);
  return rows;
}

export async function loadSnapshot(client) {
  const db = {};
  for (const entity of ENTITIES) db[entity.name] = await loadEntity(client, entity);
  return db;
}

const placeholders = (count, start = 1) => Array.from({ length: count }, (_, index) => `$${start + index}`).join(", ");

async function replaceLinks(client, entity, row) {
  for (const link of entity.links || []) {
    await client.query(`DELETE FROM ${link.table} WHERE ${link.fk} = $1`, [row[entity.pk]]);
    for (const item of link.write(row)) {
      const columns = [link.fk, ...link.columns];
      await client.query(`INSERT INTO ${link.table} (${columns.join(", ")}) VALUES (${placeholders(columns.length)})`, [
        row[entity.pk],
        ...link.columns.map((column) => item[column] ?? null),
      ]);
    }
  }
}

export async function flushChanges(client, db, before) {
  const plan = ENTITIES.map((entity) => {
    const original = before[entity.name];
    const current = new Map(db[entity.name].map((row) => [row[entity.pk], row]));
    const removed = [...original.keys()].filter((key) => !current.has(key));
    const written = db[entity.name].filter(
      (row) => !original.has(row[entity.pk]) || original.get(row[entity.pk]) !== fingerprint(entity, row),
    );
    return { entity, removed, written, original };
  });
  for (const { entity, removed } of [...plan].reverse()) {
    for (const key of removed) await client.query(`DELETE FROM ${entity.name} WHERE ${entity.pk} = $1`, [key]);
  }
  for (const { entity, written, original } of plan) {
    let inserted = false;
    for (const row of written) {
      if (original.has(row[entity.pk])) {
        const columns = entity.columns.filter((column) => column !== entity.pk);
        await client.query(
          `UPDATE ${entity.name} SET ${columns.map((column, index) => `${column} = $${index + 1}`).join(", ")} WHERE ${entity.pk} = $${columns.length + 1}`,
          [...columns.map((column) => valueFor(entity, column, row)), row[entity.pk]],
        );
      } else {
        const present = entity.columns.filter((column) => row[column] !== undefined);
        await client.query(
          `INSERT INTO ${entity.name} (${present.join(", ")}) VALUES (${placeholders(present.length)})`,
          present.map((column) => valueFor(entity, column, row)),
        );
        inserted = true;
      }
      await replaceLinks(client, entity, row);
    }
    if (inserted) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${entity.name}', '${entity.pk}'), (SELECT COALESCE(MAX(${entity.pk}), 1) FROM ${entity.name}))`,
      );
    }
  }
}

export class UnitOfWork {
  constructor(client, db, write) {
    this.client = client;
    this.db = db;
    this.write = write;
    this.before = Object.fromEntries(
      ENTITIES.map((entity) => [entity.name, new Map(db[entity.name].map((row) => [row[entity.pk], fingerprint(entity, row)]))]),
    );
  }

  static async begin(pool, { write = false } = {}) {
    const client = await pool.connect();
    try {
      await client.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      if (write) await client.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK]);
      return new UnitOfWork(client, await loadSnapshot(client), write);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      throw error;
    }
  }

  async commit() {
    try {
      if (this.write) await flushChanges(this.client, this.db, this.before);
      await this.client.query("COMMIT");
    } catch (error) {
      await this.client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      this.client.release();
    }
  }

  async rollback() {
    try {
      await this.client.query("ROLLBACK");
    } finally {
      this.client.release();
    }
  }
}

export async function replaceAll(pool, db) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK]);
    const names = [...ENTITIES.map((entity) => entity.name), "sessions", "login_events"];
    await client.query(`TRUNCATE ${names.join(", ")} RESTART IDENTITY CASCADE`);
    const empty = Object.fromEntries(ENTITIES.map((entity) => [entity.name, new Map()]));
    await flushChanges(client, { ...Object.fromEntries(ENTITIES.map((entity) => [entity.name, db[entity.name] || []])) }, empty);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
