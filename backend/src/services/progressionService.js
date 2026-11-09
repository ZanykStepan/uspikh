export function promoteGroups(c) {
  const { db, actor, body, parts, fail, id, audit, progressionPreview } = c;
  if (!["admin", "dean"].includes(actor.role)) fail(403, "Переведення виконує адміністратор або деканат.");
  const plan = progressionPreview(body.group_ids);
  if (actor.role === "dean" && plan.rows.some((row) => row.faculty !== actor.faculty))
    fail(403, "Деканат може переводити лише групи свого факультету.");
  if (parts[3] === "preview") return { status: 200, data: plan };
  if (parts[3] !== "apply") fail(404, "Маршрут не знайдено.");
  if (body.preview_key !== plan.key) fail(409, "Дані змінилися. Перегляньте план ще раз.");
  for (const row of plan.rows) {
    const group = db.groups.find((item) => item.group_id === row.group_id);
    const oldName = group.name;
    group.course = row.course_after;
    group.name = oldName.replace(/-(\d)(\d+)$/, (match, course, suffix) =>
      Number(course) === row.course_before ? `-${row.course_after}${suffix}` : match,
    );
  }
  for (const stream of db.streams.filter((item) => item.group_ids.every((id) => plan.group_ids.includes(id)))) {
    const oldCourse = plan.rows.find((row) => row.group_id === stream.group_ids[0])?.course_before;
    stream.name = stream.name.replace(/-(\d)$/, (match, course) => (Number(course) === oldCourse ? `-${oldCourse + 1}` : match));
  }
  const startYear = Number(plan.next_academic_year.slice(0, 4));
  for (const term of plan.new_semesters)
    db.semesters.push({
      semester_id: id("semesters", "semester_id"),
      academic_year: plan.next_academic_year,
      term_number: term,
      start_date: term === 1 ? `${startYear}-09-01` : `${startYear + 1}-02-01`,
      end_date: term === 1 ? `${startYear}-12-31` : `${startYear + 1}-06-30`,
      is_current: false,
    });
  if (db.groups.filter((group) => group.status === "active").every((group) => group.admission_year + group.course - 1 >= startYear)) {
    db.semesters.forEach((semester) => {
      semester.is_current = false;
    });
    db.semesters.find((semester) => semester.academic_year === plan.next_academic_year && semester.term_number === 1).is_current = true;
  }
  db.group_promotions ||= [];
  db.group_promotions.push({
    promotion_id: id("group_promotions", "promotion_id"),
    actor_id: actor.user_id,
    at: new Date().toISOString(),
    group_ids: plan.group_ids,
    academic_year: plan.next_academic_year,
    rows: plan.rows,
  });
  audit(
    actor,
    "groups.promote",
    `year:${plan.next_academic_year}`,
    plan.rows.map((row) => `${row.name}: ${row.course_before}→${row.course_after}`).join("; "),
  );
  return { status: 200, data: plan };
}

export function graduateGroups(c) {
  const { db, actor, body, parts, fail, id, audit, graduationPreview } = c;
  if (!["admin", "dean"].includes(actor.role)) fail(403, "Випуск виконує адміністратор або деканат.");
  const plan = graduationPreview(body.group_ids);
  if (actor.role === "dean" && plan.rows.some((row) => row.faculty !== actor.faculty))
    fail(403, "Деканат може випускати лише групи свого факультету.");
  if (parts[3] === "preview") return { status: 200, data: plan };
  if (parts[3] !== "apply") fail(404, "Маршрут не знайдено.");
  if (body.preview_key !== plan.key) fail(409, "Дані змінилися. Перегляньте план ще раз.");
  if (plan.blockers.length) fail(409, plan.blockers.join(" "));
  const at = new Date().toISOString();
  for (const row of plan.rows) {
    const group = db.groups.find((item) => item.group_id === row.group_id);
    group.name = row.archived_name;
    group.status = "graduated";
    group.graduated_at = at;
    group.graduation_year = plan.graduation_year;
    for (const studentId of row.graduate_ids) {
      const student = db.users.find((user) => user.user_id === studentId);
      student.student_status = "graduated";
      student.graduated_at = at;
      student.status = student.roles.some((role) => role !== "student") ? "active" : "graduated";
    }
    for (const studentId of row.held_ids) db.users.find((user) => user.user_id === studentId).student_status = "repeat_pending";
  }
  for (const item of plan.streams) {
    const stream = db.streams.find((row) => row.stream_id === item.stream_id);
    stream.name = item.archived_name;
    stream.status = "graduated";
    stream.graduated_at = at;
  }
  db.graduations.push({
    graduation_id: id("graduations", "graduation_id"),
    actor_id: actor.user_id,
    at,
    academic_year: plan.academic_year,
    graduation_year: plan.graduation_year,
    course: plan.course,
    group_ids: plan.group_ids,
    rows: plan.rows,
    streams: plan.streams,
  });
  db.group_promotions ||= [];
  db.group_promotions.push({
    promotion_id: id("group_promotions", "promotion_id"),
    actor_id: actor.user_id,
    at,
    group_ids: plan.group_ids,
    academic_year: plan.academic_year,
    rows: plan.rows.map((row) => ({
      group_id: row.group_id,
      old_name: row.name,
      new_name: row.archived_name,
      from_course: row.course,
      to_course: null,
      new_status: "graduated",
    })),
  });
  audit(
    actor,
    "groups.graduate",
    `year:${plan.graduation_year}`,
    plan.rows.map((row) => `${row.name}: випущено ${row.graduate_ids.length}, повторний курс ${row.held_ids.length}`).join("; "),
  );
  return { status: 200, data: plan };
}
