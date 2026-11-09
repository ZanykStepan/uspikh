import { config } from "../src/config/index.js";
import { createPool } from "../src/db/pool.js";
import { seedDatabase } from "./seed.mjs";
import { loadSnapshot } from "../src/repositories/unitOfWork.js";
import { bootstrapFilters } from "../src/repositories/bootstrapScope.js";
import { createContext } from "../src/services/domainContext.js";
import { buildBootstrap } from "../src/services/bootstrapService.js";

const STUDENTS = Number(process.argv[2] || 3000);
const pool = createPool(config.testDatabaseUrl);

await seedDatabase(pool);
await pool.query(
  `INSERT INTO users (full_name, email, role, status, student_status, group_id, faculty)
   SELECT 'Студент ' || n, 'bench' || n || '@pnu.edu.ua', 'student', 'active', 'active', 1, 'Факультет математики та інформатики'
   FROM generate_series(1, $1) n`,
  [STUDENTS],
);
await pool.query("INSERT INTO user_roles (user_id, role) SELECT user_id, 'student' FROM users WHERE email LIKE 'bench%'");
await pool.query(
  "INSERT INTO assignment_roster (assignment_id, student_id, group_id) SELECT a.assignment_id, u.user_id, 1 FROM users u CROSS JOIN teaching_assignments a WHERE u.email LIKE 'bench%' AND a.assignment_id <= 4",
);
await pool.query(
  "INSERT INTO grades (student_id, lesson_id, value, recorded_by) SELECT u.user_id, l.lesson_id, 50 + (u.user_id + l.lesson_id) % 50, 7 FROM users u CROSS JOIN lessons l WHERE u.email LIKE 'bench%'",
);
await pool.query(
  "INSERT INTO attendance (student_id, lesson_id, status) SELECT u.user_id, l.lesson_id, 'present' FROM users u CROSS JOIN lessons l WHERE u.email LIKE 'bench%'",
);
const counts = (
  await pool.query(
    "SELECT (SELECT count(*) FROM users)::int users, (SELECT count(*) FROM grades)::int grades, (SELECT count(*) FROM attendance)::int attendance",
  )
).rows[0];
console.log("Обсяг даних:", counts);

async function measure(userId, role, scoped) {
  const times = [];
  for (let i = 0; i < 6; i += 1) {
    const started = performance.now();
    const client = await pool.connect();
    try {
      const db = await loadSnapshot(client, scoped ? bootstrapFilters({ userId, role }) : {});
      const actor = { ...db.users.find((user) => user.user_id === userId), role };
      const ctx = createContext(db, { currentDate: () => "2026-11-09", actor });
      buildBootstrap({ ...ctx, db, actor });
    } finally {
      client.release();
    }
    times.push(performance.now() - started);
  }
  times.shift();
  return Math.round(times.reduce((sum, value) => sum + value, 0) / times.length);
}

for (const [label, userId, role] of [
  ["студент", 1, "student"],
  ["викладач", 7, "teacher"],
]) {
  const full = await measure(userId, role, false);
  const scoped = await measure(userId, role, true);
  console.log(`${label}: повне читання ${full} мс, вибіркове ${scoped} мс (у ${(full / scoped).toFixed(1)} раза швидше)`);
}
await seedDatabase(pool);
await pool.end();
