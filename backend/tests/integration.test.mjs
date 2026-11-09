import test, { after } from "node:test";
import assert from "node:assert/strict";
import { freshClient, pool, closeTests } from "./helpers.mjs";
import { UnitOfWork } from "../src/repositories/unitOfWork.js";

after(closeTests);

test("IT-001: студента, доданого через API, збережено в БД і можна отримати за ідентифікатором", async () => {
  const call = await freshClient();
  const created = await call(
    "/users",
    "POST",
    { full_name: "Іван Петренко", email: "ivan.petrenko@pnu.edu.ua", roles: ["student"], group_id: 1, status: "active" },
    10,
  );
  assert.equal(created.status, 201);
  const id = created.data.user_id;

  const row = (await pool.query("SELECT user_id, full_name, email, role, group_id, student_status FROM users WHERE user_id = $1", [id]))
    .rows[0];
  assert.deepEqual(row, {
    user_id: id,
    full_name: "Іван Петренко",
    email: "ivan.petrenko@pnu.edu.ua",
    role: "student",
    group_id: 1,
    student_status: "active",
  });
  const roles = await pool.query("SELECT role FROM user_roles WHERE user_id = $1", [id]);
  assert.deepEqual(roles.rows, [{ role: "student" }]);

  const rosters = await pool.query("SELECT assignment_id FROM assignment_roster WHERE student_id = $1 ORDER BY assignment_id", [id]);
  assert.ok(rosters.rowCount > 0, "студента додано до складу призначень групи");

  await assert.rejects(
    pool.query("INSERT INTO users (full_name, email, role) VALUES ('Дублікат', 'ivan.petrenko@pnu.edu.ua', 'student')"),
    { code: "23505" },
  );
});

test("IT-002: оцінка та її виправлення записуються атомарно в grades, grade_history, audit_logs і notifications", async () => {
  const call = await freshClient();
  assert.equal((await call("/grades", "POST", { lesson_id: 12, student_id: 3, value: 85 }, 7)).status, 201);
  const grade = (await pool.query("SELECT grade_id, value, recorded_by FROM grades WHERE student_id = 3 AND lesson_id = 12")).rows[0];
  assert.deepEqual({ value: grade.value, recorded_by: grade.recorded_by }, { value: 85, recorded_by: 7 });

  assert.equal(
    (await call(`/grades/${grade.grade_id}`, "PATCH", { value: 90, reason: "Виправлення помилки при внесенні" }, 7)).status,
    200,
  );
  const updated = (await pool.query("SELECT value FROM grades WHERE grade_id = $1", [grade.grade_id])).rows[0];
  assert.equal(updated.value, 90);

  const history = (
    await pool.query("SELECT old_value, new_value, changed_by, reason FROM grade_history WHERE grade_id = $1", [grade.grade_id])
  ).rows;
  assert.deepEqual(history, [{ old_value: 85, new_value: 90, changed_by: 7, reason: "Виправлення помилки при внесенні" }]);

  const audit = await pool.query("SELECT action FROM audit_logs WHERE target LIKE '%student:3%' OR target = $1 ORDER BY audit_id", [
    `grade:${grade.grade_id}`,
  ]);
  assert.deepEqual(
    audit.rows.map((item) => item.action),
    ["grade.create", "grade.update"],
  );
  const notes = await pool.query("SELECT count(*)::int AS total FROM notifications WHERE user_id = 3 AND message LIKE '%оцінку%'");
  assert.equal(notes.rows[0].total, 2);

  await assert.rejects(pool.query("INSERT INTO grades (student_id, lesson_id, value) VALUES (3, 12, 70)"), { code: "23505" });
  await assert.rejects(pool.query("INSERT INTO grades (student_id, lesson_id, value) VALUES (3, 11, 101)"), { code: "23514" });
});

test("IT-003: помилка під час запису скасовує всю транзакцію (відкат)", async () => {
  await freshClient();
  const before = (
    await pool.query("SELECT (SELECT count(*) FROM grades)::int AS grades, (SELECT count(*) FROM notifications)::int AS notes")
  ).rows[0];

  const uow = await UnitOfWork.begin(pool, { write: true });
  const nextGrade = Math.max(...uow.db.grades.map((item) => item.grade_id)) + 1;
  const nextNote = Math.max(...uow.db.notifications.map((item) => item.notification_id)) + 1;
  uow.db.grades.push({
    grade_id: nextGrade,
    student_id: 3,
    lesson_id: 12,
    value: 77,
    recorded_by: 7,
    given_at: "2026-11-09T10:00:00.000Z",
    updated_at: "2026-11-09T10:00:00.000Z",
  });
  uow.db.notifications.push({
    notification_id: nextNote,
    user_id: 9999,
    message: "Некоректний отримувач",
    is_read: false,
    created_at: "2026-11-09T10:00:00.000Z",
  });
  await assert.rejects(uow.commit(), { code: "23503" });

  const after = (
    await pool.query("SELECT (SELECT count(*) FROM grades)::int AS grades, (SELECT count(*) FROM notifications)::int AS notes")
  ).rows[0];
  assert.deepEqual(after, before);
});
