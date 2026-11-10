import { DebtLifecycle } from "../domain/states/debt.js";
export function updateDebt(c) {
  const { db, actor, body, recordId, fail, events, userFaculty, isDate, debtCriteria } = c;
  const row = db.debts.find((x) => x.debt_id === recordId);
  if (!row) fail(404, "Заборгованість не знайдено.");
  if (actor.role !== "dean" || userFaculty(db.users.find((user) => user.user_id === row.student_id)) !== actor.faculty)
    fail(403, "Термін і статус боргу визначає деканат свого факультету.");
  const nextDeadline = Object.hasOwn(body, "deadline") ? body.deadline : row.deadline;
  if (Object.hasOwn(body, "deadline")) {
    const semester = db.semesters.find((item) => item.semester_id === row.semester_id);
    if (!isDate(nextDeadline) || nextDeadline <= semester.end_date) fail(422, "Термін ліквідації має бути після завершення семестру.");
  }
  let closed = false;
  if (Object.hasOwn(body, "status")) {
    if (body.status !== "closed") fail(422, "Деканат може закрити лише відкритий борг.");
    const lifecycle = new DebtLifecycle(row);
    lifecycle.assertCanClose();
    const assignment = db.teaching_assignments.find(
      (item) =>
        item.discipline_id === row.discipline_id &&
        item.semester_id === row.semester_id &&
        item.roster_student_ids.includes(row.student_id),
    );
    if (!assignment || !nextDeadline || debtCriteria(assignment, row.student_id).needsDebt)
      fail(409, "Борг можна закрити після встановлення терміну, бала не нижче 50 і оцінки обов’язкового екзамену.");
    lifecycle.close();
    closed = true;
  }
  const deadlineSet = Object.hasOwn(body, "deadline");
  if (deadlineSet) row.deadline = nextDeadline;
  events.publish({ type: "debt.updated", actor, debt: row, closed, deadlineSet });
  return { status: 200, data: row };
}
