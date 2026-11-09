import test, { after } from "node:test";
import assert from "node:assert/strict";
import { freshClient, pool, closeTests, deps } from "./helpers.mjs";
import { loadSnapshot } from "../src/repositories/unitOfWork.js";
import { bootstrapFilters } from "../src/repositories/bootstrapScope.js";
import { createContext } from "../src/services/domainContext.js";
import { buildBootstrap } from "../src/services/bootstrapService.js";

after(closeTests);

async function bootstrapWith(userId, scoped) {
  const client = await pool.connect();
  try {
    const role = (await client.query("SELECT role FROM users WHERE user_id = $1", [userId])).rows[0].role;
    const db = await loadSnapshot(client, scoped ? bootstrapFilters({ userId, role }) : {});
    const account = db.users.find((user) => user.user_id === userId);
    const actor = { ...account, role };
    const ctx = createContext(db, { currentDate: deps.today, actor });
    return buildBootstrap({ ...ctx, db, actor }).data;
  } finally {
    client.release();
  }
}

test("Вибіркове читання bootstrap дає ту саму відповідь, що й повне, для всіх ролей", async () => {
  const call = await freshClient();
  await call("/grades", "POST", { lesson_id: 12, student_id: 3, value: 85 }, 7);
  await call("/grades/1", "PATCH", { value: 91, reason: "Виправлення помилки" }, 7);
  await call("/elective_enrollments", "POST", { discipline_id: 5, semester_id: 2 }, 1);
  await call("/attendance/1", "PATCH", { status: "absent", reason: "поважна" }, 7);
  for (const userId of [1, 2, 3, 4, 7, 9, 10, 11]) {
    const full = await bootstrapWith(userId, false);
    const scoped = await bootstrapWith(userId, true);
    assert.deepEqual(scoped, full, `відповідь для користувача ${userId} відрізняється`);
  }
});

test("Студент отримує з бази лише власні оцінки, а не всі", async () => {
  await freshClient();
  const client = await pool.connect();
  try {
    const db = await loadSnapshot(client, bootstrapFilters({ userId: 1, role: "student" }));
    assert.ok(db.grades.length > 0 && db.grades.every((grade) => grade.student_id === 1));
    assert.ok(db.notifications.every((item) => item.user_id === 1));
    assert.equal(db.audit_logs.length, 0);
  } finally {
    client.release();
  }
});
