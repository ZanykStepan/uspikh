import test from "node:test";
import assert from "node:assert/strict";
import { visibleSemesters } from "../src/semesterOptions.js";

test("студент бачить тільки власні півріччя та доступні вибіркові", () => {
  const semesters = [1, 2, 3].map((semester_id) => ({ semester_id }));
  const db = {
    me: { role: "student" }, semesters,
    teaching_assignments: [{ semester_id: 1 }],
    elective_offerings: [{ semester_id: 2 }],
  };
  assert.deepEqual(visibleSemesters(db).map((item) => item.semester_id), [1, 2]);
  assert.equal(visibleSemesters({ ...db, me: { role: "admin" } }).length, 3);
});

test("новому студенту без призначень доступне поточне півріччя", () => {
  const db = {
    me: { role: "student" },
    semesters: [{ semester_id: 1 }, { semester_id: 2, is_current: true }],
    teaching_assignments: [], elective_offerings: [],
  };
  assert.deepEqual(visibleSemesters(db).map((item) => item.semester_id), [2]);
});
