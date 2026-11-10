import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { seed } from "../src/seed/data.js";
import { scoreBreakdown, convertSemesterScore, lessonTypes } from "../src/domain/scoring.js";

const goldenFile = fileURLToPath(new URL("./golden/scoring.json", import.meta.url));

function fixtureData() {
  const db = seed();
  const types = (map) => Object.fromEntries(lessonTypes.map((type) => [type, map[type] ?? 0]));
  db.weight_schemes = [
    {
      scheme_id: 1,
      discipline_id: 1,
      course: 4,
      semester_id: 1,
      weights: types({ "Лабораторна робота": 60, "Контрольна / розрахунково-графічна робота": 40 }),
    },
    { scheme_id: 2, discipline_id: 2, course: 4, semester_id: 1, weights: types({ "Лабораторна робота": 100 }) },
    {
      scheme_id: 3,
      discipline_id: 3,
      course: 4,
      semester_id: 1,
      weights: types({ "Лабораторна робота": 30, "Контрольна / розрахунково-графічна робота": 30, Екзамен: 40 }),
    },
  ];
  db.lessons.push({
    lesson_id: 100,
    assignment_id: 3,
    group_id: null,
    lesson_date: "2026-12-20",
    lesson_type: "Екзамен",
    max_score: 12,
    topic: "Екзамен",
  });
  db.grades.push({ grade_id: 100, student_id: 1, lesson_id: 100, value: 9 }, { grade_id: 101, student_id: 2, lesson_id: 100, value: 12 });
  return db;
}

function snapshot() {
  const db = fixtureData();
  const scores = [];
  for (const assignment of db.teaching_assignments) {
    for (const student of db.users.filter((user) => user.role === "student")) {
      const result = scoreBreakdown(db, assignment, student.user_id);
      scores.push({
        assignment: assignment.assignment_id,
        student: student.user_id,
        semesterScore: result.semesterScore,
        gradedCount: result.gradedCount,
        hasScheme: Boolean(result.scheme),
        types: result.types
          .filter((row) => row.count || row.weight)
          .map(({ type, mean, count, weight, contribution }) => ({ type, mean, count, weight, contribution })),
      });
    }
  }
  const conversion = Array.from({ length: 101 }, (_, score) => [score, convertSemesterScore(score)]);
  return { scores, conversion, empty: convertSemesterScore(null) };
}

test("Характеристичний тест: результати розрахунку балів і шкал не змінюються після рефакторингу", () => {
  const current = JSON.parse(JSON.stringify(snapshot()));
  if (process.env.UPDATE_GOLDEN || !existsSync(goldenFile)) {
    writeFileSync(goldenFile, JSON.stringify(current, null, 2));
    return;
  }
  assert.deepEqual(current, JSON.parse(readFileSync(goldenFile, "utf8")));
});
