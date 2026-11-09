import pg from "pg";

pg.types.setTypeParser(1082, (value) => value);
pg.types.setTypeParser(1184, (value) => new Date(value).toISOString());

export function createPool(connectionString) {
  return new pg.Pool({ connectionString, max: 10 });
}
