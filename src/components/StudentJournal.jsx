import { useState } from "react";
import { weightScheme } from "../domain";
import { WeightSummary } from "./Weights";

const attendanceLabel = (record) => record?.status === "present" ? "Присутній" : record?.status === "absent" ? `Пропуск · ${record.reason || "причину не вказано"}` : "Ще не позначено";

export default function StudentJournal({ db, assignment, studentId, discipline }) {
  const [typeFilter, setTypeFilter] = useState("");
  const scheme = weightScheme(db, assignment);
  const lessons = db.lessons.filter((lesson) => lesson.assignment_id === assignment.assignment_id && (!lesson.group_id || Number(assignment.student_group_ids?.[studentId]) === lesson.group_id)).sort((a, b) => b.lesson_date.localeCompare(a.lesson_date) || b.lesson_id-a.lesson_id);
  const types = [...new Set(lessons.map((lesson) => lesson.lesson_type))];
  const shown = lessons.filter((lesson) => !typeFilter || lesson.lesson_type === typeFilter);
  const rows = shown.map((lesson) => ({
    lesson,
    grade: db.grades.find((item) => item.student_id === studentId && item.lesson_id === lesson.lesson_id),
    attendance: db.attendance.find((item) => item.student_id === studentId && item.lesson_id === lesson.lesson_id),
  }));
  return <>
    <section className="panel unified-journal">
      <div className="panel-head"><div><p className="eyebrow">ЗАНЯТТЯ Й РЕЗУЛЬТАТИ</p><h2>Журнал занять</h2><p>Оцінка та відвідуваність стосуються одного заняття в одному рядку.</p></div><label className="field-inline">Тип заняття<select aria-label="Тип занять у журналі" value={typeFilter} onChange={(event)=>setTypeFilter(event.target.value)}><option value="">Усі типи</option>{types.map((type)=><option key={type}>{type}</option>)}</select></label></div>
      <div className="table-wrap journal-desktop"><table className="unified-table student-journal-table"><colgroup><col className="journal-date"/><col className="journal-topic"/><col className="journal-type"/><col className="journal-grade"/><col className="journal-attendance"/></colgroup><thead><tr><th>Дата</th><th>Заняття</th><th>Тип і вага</th><th>Оцінка</th><th>Відвідуваність</th></tr></thead><tbody>{rows.map(({lesson,grade,attendance})=><tr key={lesson.lesson_id}><td>{new Date(lesson.lesson_date+"T12:00:00").toLocaleDateString("uk-UA",{day:"2-digit",month:"2-digit",year:"numeric"})}</td><td><strong>{lesson.topic}</strong></td><td><span className="type-label">{lesson.lesson_type}</span><small>{scheme ? `Вага типу ${scheme.weights[lesson.lesson_type] ?? 0}%` : "Вагу не встановлено"}</small></td><td><strong>{grade?`${grade.value} / ${lesson.max_score||100}`:"Не оцінено"}</strong></td><td>{attendanceLabel(attendance)}</td></tr>)}</tbody></table></div>
      <div className="journal-mobile">{rows.map(({lesson,grade,attendance})=><article className="journal-mobile-card" key={lesson.lesson_id}><div className="journal-mobile-heading"><time dateTime={lesson.lesson_date}>{new Date(lesson.lesson_date+"T12:00:00").toLocaleDateString("uk-UA",{day:"2-digit",month:"2-digit",year:"numeric"})}</time><span>{lesson.lesson_type}</span></div><strong className="journal-mobile-topic">{lesson.topic}</strong><div className="journal-mobile-results"><div><small>Оцінка</small><strong>{grade?`${grade.value} / ${lesson.max_score||100}`:"Не оцінено"}</strong></div><div><small>Відвідуваність</small><strong>{attendanceLabel(attendance)}</strong></div></div><small className="journal-mobile-weight">{scheme ? `Вага типу ${scheme.weights[lesson.lesson_type] ?? 0}%` : "Вагу не встановлено"}</small></article>)}</div>
      {!lessons.length&&<div className="empty"><h3>Занять ще немає</h3></div>}
      {lessons.length>0&&!shown.length&&<div className="empty"><h3>Занять цього типу немає</h3></div>}
    </section>
    <WeightSummary db={db} assignment={assignment} studentId={studentId} discipline={discipline}/>
  </>;
}
