import { useState } from "react";
import { normalizedGrade, scoreBreakdown } from "../domain";

export default function GradeReview({ db, student, groupId }) {
  const [assignmentId,setAssignmentId]=useState(null);
  if (!student) return null;
  const assignments=db.teaching_assignments.filter((assignment)=>assignment.roster_student_ids?.includes(student.user_id)&&(!groupId||Number(assignment.student_group_ids?.[student.user_id])===groupId));
  const current=assignments.find((assignment)=>assignment.assignment_id===assignmentId)||assignments[0];
  const discipline=db.disciplines.find((item)=>item.discipline_id===current?.discipline_id);
  const semester=db.semesters.find((item)=>item.semester_id===current?.semester_id);
  const result=current?scoreBreakdown(db,current,student.user_id):null;
  const lessons=db.lessons.filter((lesson)=>lesson.assignment_id===current?.assignment_id&&(!lesson.group_id||lesson.group_id===Number(current?.student_group_ids?.[student.user_id]))).sort((a,b)=>b.lesson_date.localeCompare(a.lesson_date));
  const types=[...new Set(lessons.map((lesson)=>lesson.lesson_type))];
  return <section className="panel grade-review">
    <div className="panel-head"><div><p className="eyebrow">ЖУРНАЛ ЗА ДИСЦИПЛІНОЮ</p><h2>{student.full_name}</h2><p>Оберіть предмет і півріччя. Оцінки доступні лише для перегляду.</p></div></div>
    {current?<>
      <div className="review-toolbar"><label className="field-inline">Дисципліна й півріччя<select aria-label="Дисципліна для перегляду оцінок" value={current.assignment_id} onChange={(event)=>setAssignmentId(Number(event.target.value))}>{assignments.map((assignment)=>{const subject=db.disciplines.find((item)=>item.discipline_id===assignment.discipline_id);const term=db.semesters.find((item)=>item.semester_id===assignment.semester_id);return <option key={assignment.assignment_id} value={assignment.assignment_id}>{subject?.name} · {term?.term_number} півріччя {term?.academic_year}</option>})}</select></label></div>
      <div className="review-summary"><div><small>Дисципліна</small><strong>{discipline?.name}</strong><span>{semester?.term_number} півріччя · {semester?.academic_year}</span></div><div><small>Бал за формулою</small><strong>{result?.scheme?`${String(result.semesterScore).replace(".",",")} / 100`:"Не розраховано"}</strong><span>{result?.scheme?"За вагами типів занять":"Ваги не встановлено"}</span></div></div>
      {result?.scheme&&<div className="review-weights">{result.types.filter((row)=>row.weight>0).map((row)=><span key={row.type}>{row.type}: <strong>{row.weight}%</strong></span>)}</div>}
      {types.map((type)=><div className="review-type" key={type}><h3>{type}</h3><div className="table-wrap"><table className="mobile-stack-table"><thead><tr><th>Дата</th><th>Заняття</th><th>Оцінка</th><th>У шкалі 100</th></tr></thead><tbody>{lessons.filter((lesson)=>lesson.lesson_type===type).map((lesson)=>{const grade=db.grades.find((item)=>item.lesson_id===lesson.lesson_id&&item.student_id===student.user_id);return <tr key={lesson.lesson_id}><td data-label="Дата">{lesson.lesson_date}</td><td data-label="Заняття">{lesson.topic}</td><td data-label="Оцінка"><strong>{grade?`${grade.value} / ${lesson.max_score||100}`:"Не оцінено"}</strong></td><td data-label="У шкалі 100">{grade?`${normalizedGrade(grade,lesson)} / 100`:"—"}</td></tr>})}</tbody></table></div></div>)}
      {!lessons.length&&<div className="empty"><h3>Занять у дисципліні ще немає</h3></div>}
    </>:<div className="empty"><h3>Дисциплін поки немає</h3></div>}
  </section>;
}
