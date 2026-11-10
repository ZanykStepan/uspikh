import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { freshClient, pool, closeTests } from "./helpers.mjs";

after(closeTests);
const goldenFile = fileURLToPath(new URL("./golden/events.json", import.meta.url));

async function sideEffects() {
  const notifications = (await pool.query("SELECT user_id, message, is_read FROM notifications ORDER BY notification_id")).rows;
  const audit = (await pool.query("SELECT actor_id, action, target, detail FROM audit_logs ORDER BY audit_id")).rows;
  return { notifications, audit };
}

test("Характеристичний тест: сповіщення й журнал аудиту для типових сценаріїв не змінюються після рефакторингу", async () => {
  const call = await freshClient({ today: "2026-11-09" });
  const steps = [];
  const run = async (label, path, method, body, user) => {
    const response = await call(path, method, body, user);
    steps.push({ label, status: response.status });
    return response;
  };
  await run("оцінка створена", "/grades", "POST", { lesson_id: 12, student_id: 3, value: 85 }, 7);
  await run("оцінка виправлена", "/grades/1", "PATCH", { value: 91, reason: "Виправлення помилки" }, 7);
  await run("пропуск", "/attendance/1", "PATCH", { status: "absent", reason: "поважна" }, 7);
  await run("пропуск повторно", "/attendance/1", "PATCH", { status: "absent", reason: "поважна" }, 7);
  await run("присутній", "/attendance/1", "PATCH", { status: "present" }, 7);
  await run("заявка", "/elective_enrollments", "POST", { discipline_id: 5, semester_id: 2 }, 1);
  await run("заявка підтверджена", "/elective_enrollments/1", "PATCH", { status: "approved" }, 11);
  await run("заявка підтверджена повторно", "/elective_enrollments/1", "PATCH", { status: "approved" }, 11);
  await run("заявка відхилена", "/elective_enrollments/1", "PATCH", { status: "rejected" }, 11);
  await run("заявка некоректна", "/elective_enrollments/1", "PATCH", { status: "pending" }, 11);
  await run("заявка 2", "/elective_enrollments", "POST", { discipline_id: 6, semester_id: 2 }, 1);
  await run("заявка скасована", "/elective_enrollments/2", "DELETE", undefined, 1);
  await run("ліміти", "/elective_limits", "POST", { group_id: 1, catalog1_credits: 9, catalog2_credits: 12, max_disciplines: 10 }, 11);
  const snapshot = { steps, ...(await sideEffects()) };

  const late = await freshClient({ today: "2027-01-15" });
  await pool.query("INSERT INTO weight_schemes (discipline_id, course, semester_id) VALUES (1, 4, 1)");
  await pool.query(
    "INSERT INTO weight_scheme_items (scheme_id, lesson_type, weight) SELECT scheme_id, t.type, t.weight FROM weight_schemes CROSS JOIN (VALUES ('Лабораторна робота', 40), ('Контрольна / розрахунково-графічна робота', 40), ('Екзамен', 20)) AS t(type, weight)",
  );
  const lateSteps = [];
  const go = async (label, path, method, body, user) => {
    const response = await late(path, method, body, user);
    lateSteps.push({ label, status: response.status });
    return response;
  };
  await go(
    "запит на виправлення",
    "/grade_corrections",
    "POST",
    { lesson_id: 1, student_id: 1, proposed_value: 40, reason: "Помилка при внесенні" },
    7,
  );
  await go(
    "запит повторно",
    "/grade_corrections",
    "POST",
    { lesson_id: 1, student_id: 1, proposed_value: 41, reason: "Ще одна причина" },
    7,
  );
  await go("запит відхилено", "/grade_corrections/1", "PATCH", { status: "rejected" }, 11);
  await go("рішення повторно", "/grade_corrections/1", "PATCH", { status: "approved" }, 11);
  await go(
    "новий запит",
    "/grade_corrections",
    "POST",
    { lesson_id: 1, student_id: 1, proposed_value: 40, reason: "Помилка при внесенні" },
    7,
  );
  await go("запит погоджено", "/grade_corrections/2", "PATCH", { status: "approved" }, 11);
  await go("термін боргу", "/debts/1", "PATCH", { deadline: "2027-03-01" }, 11);
  await go("закриття боргу", "/debts/1", "PATCH", { status: "closed" }, 11);
  await go("некоректний статус боргу", "/debts/1", "PATCH", { status: "open" }, 11);
  snapshot.lateSteps = lateSteps;
  snapshot.late = await sideEffects();
  snapshot.debts = (await pool.query("SELECT student_id, discipline_id, status, deadline FROM debts ORDER BY debt_id")).rows;
  snapshot.corrections = (
    await pool.query(
      "SELECT lesson_id, student_id, proposed_value, previous_value, status FROM grade_correction_requests ORDER BY request_id",
    )
  ).rows;

  const current = JSON.parse(JSON.stringify(snapshot));
  if (process.env.UPDATE_GOLDEN || !existsSync(goldenFile)) {
    writeFileSync(goldenFile, JSON.stringify(current, null, 2));
    return;
  }
  assert.deepEqual(current, JSON.parse(readFileSync(goldenFile, "utf8")));
});
