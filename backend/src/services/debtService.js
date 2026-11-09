export function updateDebt(c) {
  const { db, actor, body, recordId, fail, id, audit, userFaculty, isDate, debtCriteria } = c;
  const row = db.debts.find((x) => x.debt_id === recordId);
  if (!row) fail(404, "Заборгованість не знайдено.");
  if (actor.role !== "dean" || userFaculty(db.users.find((user) => user.user_id === row.student_id)) !== actor.faculty)
    fail(403, "Термін і статус боргу визначає деканат свого факультету.");
  const nextDeadline = Object.hasOwn(body, "deadline") ? body.deadline : row.deadline;
  if (Object.hasOwn(body, "deadline")) {
    const semester = db.semesters.find((item) => item.semester_id === row.semester_id);
    if (!isDate(nextDeadline) || nextDeadline <= semester.end_date) fail(422, "Термін ліквідації має бути після завершення півріччя.");
  }
  if (Object.hasOwn(body, "status")) {
    if (body.status !== "closed" || row.status !== "open") fail(422, "Деканат може закрити лише відкритий борг.");
    const assignment = db.teaching_assignments.find(
      (item) =>
        item.discipline_id === row.discipline_id &&
        item.semester_id === row.semester_id &&
        item.roster_student_ids.includes(row.student_id),
    );
    if (!assignment || !nextDeadline || debtCriteria(assignment, row.student_id).needsDebt)
      fail(409, "Борг можна закрити після встановлення терміну, бала не нижче 50 і оцінки обов’язкового екзамену.");
    row.status = "closed";
    row.closed_at = new Date().toISOString();
    db.notifications.push({
      notification_id: id("notifications", "notification_id"),
      user_id: row.student_id,
      message: "Академічну заборгованість ліквідовано.",
      is_read: false,
      created_at: new Date().toISOString(),
    });
  }
  if (Object.hasOwn(body, "deadline")) {
    row.deadline = nextDeadline;
    db.notifications.push({
      notification_id: id("notifications", "notification_id"),
      user_id: row.student_id,
      message: `Термін ліквідації заборгованості: ${row.deadline}.`,
      is_read: false,
      created_at: new Date().toISOString(),
    });
  }
  audit(actor, "debt.update", `debt:${recordId}`, `${row.status}; термін ${row.deadline || "не встановлено"}`);
  return { status: 200, data: row };
}
