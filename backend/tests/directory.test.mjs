import test, { after } from "node:test";
import assert from "node:assert/strict";
import { freshClient, pool, closeTests } from "./helpers.mjs";

after(closeTests);

const student = (n) => ({
  full_name: `Тестовий Студент ${n}`,
  email: `student${n}@pnu.edu.ua`,
  roles: ["student"],
  group_id: 1,
  status: "active",
});

test("Видалення: запис без пов’язаних даних видаляється разом із допоміжними рядками", async () => {
  const call = await freshClient();
  const created = await call("/users", "POST", student(1), 10);
  assert.equal(created.status, 201);
  const id = created.data.user_id;
  assert.ok((await pool.query("SELECT count(*)::int AS n FROM assignment_roster WHERE student_id = $1", [id])).rows[0].n > 0);
  const removed = await call(`/users/${id}`, "DELETE", undefined, 10);
  assert.equal(removed.status, 200);
  for (const table of ["users", "user_roles", "assignment_roster", "attendance"]) {
    const column = table === "users" ? "user_id" : table === "user_roles" ? "user_id" : "student_id";
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [id])).rows[0].n, 0, table);
  }
  const audit = await pool.query("SELECT action FROM audit_logs WHERE action = 'users.delete'");
  assert.equal(audit.rowCount, 1);
});

test("Видалення заборонено, якщо є пов’язані дані, власний профіль або не адміністратор", async () => {
  const call = await freshClient();
  const withGrades = await call("/users/1", "DELETE", undefined, 10);
  assert.equal(withGrades.status, 409);
  assert.match(withGrades.data.message, /оцінки/);
  assert.equal((await call("/users/10", "DELETE", undefined, 10)).status, 409);
  assert.equal((await call("/groups/1", "DELETE", undefined, 10)).status, 409);
  assert.equal((await call("/disciplines/1", "DELETE", undefined, 10)).status, 409);
  assert.equal((await call("/semesters/1", "DELETE", undefined, 10)).status, 409);
  assert.equal((await call("/users/2", "DELETE", undefined, 11)).status, 403);
  assert.equal((await call("/users/2", "DELETE", undefined, 7)).status, 403);
  assert.equal((await call("/users/9999", "DELETE", undefined, 10)).status, 404);
});

test("Порожню групу, потік-кандидат і невикористаний семестр можна видалити", async () => {
  const call = await freshClient();
  const group = await call(
    "/groups",
    "POST",
    {
      name: "ТЕСТ-11",
      course: 1,
      program_years: 4,
      admission_year: 2030,
      specialty: "Тест",
      faculty: "Факультет математики та інформатики",
    },
    10,
  );
  assert.equal(group.status, 201);
  assert.equal((await call(`/groups/${group.data.group_id}`, "DELETE", undefined, 10)).status, 200);
  const semester = await call(
    "/semesters",
    "POST",
    { academic_year: "2040/2041", term_number: 1, start_date: "2040-09-01", end_date: "2040-12-31" },
    10,
  );
  assert.equal(semester.status, 201);
  assert.equal((await call(`/semesters/${semester.data.semester_id}`, "DELETE", undefined, 10)).status, 200);
});

const csv = (rows) => rows.map((row) => row.join(";")).join("\n");

test("Імпорт студентів: перевірка без збереження, помилки в рядках і успішне збереження", async () => {
  const call = await freshClient();
  const before = (await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n;
  const good = csv([
    ["ПІБ", "Пошта", "Група"],
    ["Іваненко Марія Петрівна", "maria@pnu.edu.ua", "ІПЗ-41"],
    ["Коваль Олег Іванович", "oleg@cnu.edu.ua", "ІПЗ-42"],
  ]);
  const dry = await call("/users/import", "POST", { csv: good, dry_run: true }, 10);
  assert.equal(dry.status, 200);
  assert.equal(dry.data.valid, 2);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n, before);

  const broken = csv([
    ["Іваненко Марія Петрівна", "maria@pnu.edu.ua", "ІПЗ-41"],
    ["Хтось", "x@gmail.com", "ІПЗ-41"],
    ["Дублікат Користувач", "demo1@pnu.edu.ua", "ІПЗ-41"],
    ["Без Групи Користувач", "nogroup@pnu.edu.ua", "НЕМА-99"],
    ["Лише Два"],
  ]);
  const failed = await call("/users/import", "POST", { csv: broken }, 10);
  assert.equal(failed.status, 422);
  assert.equal(failed.data.errors, 4);
  assert.deepEqual(
    failed.data.rows.map((row) => row.status),
    ["ok", "error", "error", "error", "error"],
  );
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n, before);

  const saved = await call("/users/import", "POST", { csv: good }, 10);
  assert.equal(saved.status, 201);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n, before + 2);
  const roster = await pool.query(
    "SELECT count(*)::int AS n FROM assignment_roster r JOIN users u ON u.user_id = r.student_id WHERE u.email = 'maria@pnu.edu.ua'",
  );
  assert.ok(roster.rows[0].n > 0);
  assert.equal((await call("/users/import", "POST", { csv: good }, 7)).status, 403);
});

test("Деканат імпортує лише в групи свого факультету", async () => {
  const call = await freshClient();
  await call(
    "/groups",
    "POST",
    { name: "ЕК-11", course: 1, program_years: 4, admission_year: 2026, specialty: "Економіка", faculty: "Економічний факультет" },
    10,
  );
  const result = await call(
    "/users/import",
    "POST",
    { csv: csv([["Чужий Студент Тест", "foreign@pnu.edu.ua", "ЕК-11"]]), dry_run: true },
    11,
  );
  assert.equal(result.status, 200);
  assert.equal(result.data.rows[0].status, "error");
  const own = await call("/users/import", "POST", { csv: csv([["Свій Студент Тест", "own@pnu.edu.ua", "ІПЗ-41"]]) }, 11);
  assert.equal(own.status, 201);
});

test("Журнал дій: деканат бачить дії свого факультету, чужі не бачить", async () => {
  const call = await freshClient();
  await call("/grades", "POST", { lesson_id: 12, student_id: 3, value: 85 }, 7);
  await call(
    "/groups",
    "POST",
    { name: "ЕК-11", course: 1, program_years: 4, admission_year: 2026, specialty: "Економіка", faculty: "Економічний факультет" },
    10,
  );
  const dean = (await call("/bootstrap", "GET", null, 11)).data;
  assert.ok(dean.audit_logs.some((entry) => entry.action === "grade.create"));
  assert.ok(dean.audit_logs.every((entry) => entry.faculty === "Факультет математики та інформатики"));
  assert.ok(!dean.audit_logs.some((entry) => entry.detail === "ЕК-11"));
  const admin = (await call("/bootstrap", "GET", null, 10)).data;
  assert.ok(admin.audit_logs.some((entry) => entry.detail === "ЕК-11"));
  assert.equal((await call("/bootstrap", "GET", null, 7)).data.audit_logs.length, 0);
});
