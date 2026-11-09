import test from "node:test";
import assert from "node:assert/strict";
import { isValidCalendarDate, isCorporateEmail, isScoreInRange, isDateWithin } from "../src/domain/validators.js";
import { validateGrade, normalizedGrade, scoreBreakdown, convertSemesterScore, lessonTypes } from "../src/domain/scoring.js";
import { passwordProblem, hashSecret, verifySecret, generateTemporaryPassword } from "../src/utils/passwords.js";

const DOMAINS = ["pnu.edu.ua", "cnu.edu.ua"];

test("UT-01: календарна дата — коректні та неіснуючі значення", () => {
  assert.equal(isValidCalendarDate("2026-11-09"), true);
  assert.equal(isValidCalendarDate("2028-02-29"), true);
  assert.equal(isValidCalendarDate("2026-02-30"), false);
  assert.equal(isValidCalendarDate("09.11.2026"), false);
  assert.equal(isValidCalendarDate(20261109), false);
});

test("UT-02: дата заняття має належати семестру", () => {
  assert.equal(isDateWithin("2026-10-07", "2026-09-01", "2026-12-31"), true);
  assert.equal(isDateWithin("2026-09-01", "2026-09-01", "2026-12-31"), true);
  assert.equal(isDateWithin("2027-01-01", "2026-09-01", "2026-12-31"), false);
});

test("UT-03: корпоративна пошта — дозволені лише домени університету", () => {
  assert.equal(isCorporateEmail("student@pnu.edu.ua", DOMAINS), true);
  assert.equal(isCorporateEmail("Teacher@CNU.EDU.UA", DOMAINS), true);
  assert.equal(isCorporateEmail("student@gmail.com", DOMAINS), false);
  assert.equal(isCorporateEmail("student@pnu.edu.ua.evil.com", DOMAINS), false);
  assert.equal(isCorporateEmail("не пошта", DOMAINS), false);
  assert.equal(isCorporateEmail(null, DOMAINS), false);
});

test("UT-04: оцінка в межах шкали заняття", () => {
  assert.equal(isScoreInRange(0), true);
  assert.equal(isScoreInRange(100), true);
  assert.equal(isScoreInRange(12, 12), true);
  assert.equal(isScoreInRange(13, 12), false);
  assert.equal(isScoreInRange(-1), false);
  assert.equal(isScoreInRange(2.5), false);
});

test("UT-05: перевірка оцінки на формі — діапазон і причина виправлення", () => {
  assert.equal(validateGrade("0", "", false), "");
  assert.equal(validateGrade("100", "", false), "");
  for (const value of ["", "abc", -1, 101, 2.5]) assert.notEqual(validateGrade(value, "", false), "");
  assert.notEqual(validateGrade(90, "", true), "");
  assert.notEqual(validateGrade(90, "ні", true), "");
  assert.equal(validateGrade(90, "Помилка при внесенні", true), "");
});

test("UT-06: нормалізація оцінки до 100 балів", () => {
  assert.equal(normalizedGrade({ value: 6 }, { max_score: 12 }), 50);
  assert.equal(normalizedGrade({ value: 5 }, { max_score: 5 }), 100);
  assert.equal(normalizedGrade({ value: 85 }, { max_score: 100 }), 85);
  assert.equal(normalizedGrade(null, { max_score: 100 }), null);
});

test("UT-07: семестровий бал за вагами типів занять", () => {
  const weights = Object.fromEntries(lessonTypes.map((type) => [type, 0]));
  weights["Лабораторна робота"] = 60;
  weights["Екзамен"] = 40;
  const db = {
    groups: [{ group_id: 1, course: 4 }],
    streams: [],
    weight_schemes: [{ discipline_id: 1, semester_id: 1, course: 4, weights }],
    lessons: [
      { lesson_id: 1, assignment_id: 1, lesson_type: "Лабораторна робота", max_score: 100 },
      { lesson_id: 2, assignment_id: 1, lesson_type: "Лабораторна робота", max_score: 100 },
      { lesson_id: 3, assignment_id: 1, lesson_type: "Екзамен", max_score: 100 },
    ],
    grades: [
      { lesson_id: 1, student_id: 1, value: 80 },
      { lesson_id: 2, student_id: 1, value: 100 },
      { lesson_id: 3, student_id: 1, value: 50 },
    ],
  };
  const assignment = { assignment_id: 1, discipline_id: 1, semester_id: 1, group_id: 1, student_group_ids: { 1: 1 } };
  assert.equal(scoreBreakdown(db, assignment, 1).semesterScore, 74);
});

test("UT-08: без встановлених ваг семестровий бал не обчислюється", () => {
  const db = { groups: [{ group_id: 1, course: 4 }], streams: [], weight_schemes: [], lessons: [], grades: [] };
  const assignment = { assignment_id: 1, discipline_id: 1, semester_id: 1, group_id: 1, student_group_ids: {} };
  assert.equal(scoreBreakdown(db, assignment, 1).semesterScore, null);
});

test("UT-09: переведення балу в національну шкалу, поріг 50", () => {
  assert.equal(convertSemesterScore(49).five, 2);
  assert.equal(convertSemesterScore(50).five, 3);
  assert.equal(convertSemesterScore(90).five, 5);
  assert.equal(convertSemesterScore(100).ects, "A");
  assert.equal(convertSemesterScore(null), null);
});

test("UT-10: пароль — вимоги, хешування із сіллю, тимчасовий пароль", async () => {
  assert.notEqual(passwordProblem("short1"), null);
  assert.notEqual(passwordProblem("тільки-літери-без-цифр"), null);
  assert.equal(passwordProblem("Reserve2026pass"), null);
  const first = await hashSecret("Reserve2026pass");
  const second = await hashSecret("Reserve2026pass");
  assert.notEqual(first, second);
  assert.equal(await verifySecret("Reserve2026pass", first), true);
  assert.equal(await verifySecret("reserve2026pass", first), false);
  assert.match(generateTemporaryPassword(), /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
});
