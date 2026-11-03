import { Fragment, useState } from "react";
import { validateGrade, todayKyiv } from "../domain";

function InlineGradeEditor({ grade, lesson, student, busy, locked, onSave, onClose }) {
  const [value,setValue]=useState(grade?.value ?? "");
  const [reason,setReason]=useState("");
  const [error,setError]=useState("");
  const maximum=lesson.max_score||100;
  return <form className="inline-grade-editor" onSubmit={async(event)=>{
    event.preventDefault();
    const message=validateGrade(value,reason,!!grade||locked,maximum);
    if(message){setError(message);return;}
    const ok=await onSave(locked?"/grade_corrections":grade?`/grades/${grade.grade_id}`:"/grades",locked?"POST":grade?"PATCH":"POST",locked?{student_id:student.user_id,lesson_id:lesson.lesson_id,proposed_value:Number(value),reason}:{student_id:student.user_id,lesson_id:lesson.lesson_id,value:Number(value),reason});
    if(ok)onClose();else setError("Оцінку не збережено. Перевірте повідомлення вище.");
  }}><strong>{student.full_name} · {lesson.topic}</strong><div className="inline-grade-controls"><label>Бал 0–{maximum}<input autoFocus type="text" inputMode="numeric" pattern="[0-9]*" value={value} onChange={(event)=>{const next=event.target.value;if(next===""||/^\d+$/.test(next)&&Number(next)<=maximum){setValue(next);setError("");}else setError(`Введіть ціле число від 0 до ${maximum}.`);}} onPaste={(event)=>{const pasted=event.clipboardData.getData("text").trim();if(!/^\d+$/.test(pasted)||Number(pasted)>maximum){event.preventDefault();setError(`Введіть ціле число від 0 до ${maximum}.`);}}}/></label>{(grade||locked)&&<label>Причина виправлення<input value={reason} maxLength={255} onChange={(event)=>setReason(event.target.value)} placeholder="Причина (мінімум 5 символів)"/></label>}<button className="primary" disabled={busy}>{locked?"Надіслати запит":"Зберегти"}</button><button type="button" onClick={onClose}>Скасувати</button></div>{error&&<p className="error" role="alert">{error}</p>}</form>;
}

export default function TeacherLessonCard({ db, assignment, lesson, students, busy, onAction, defaultOpen=false }) {
  const [open,setOpen]=useState(defaultOpen);
  const [editing,setEditing]=useState(null);
  const locked=db.semesters.find((term)=>term.semester_id===assignment.semester_id)?.end_date<todayKyiv();
  const graded=students.filter((student)=>db.grades.some((grade)=>grade.student_id===student.user_id&&grade.lesson_id===lesson.lesson_id)).length;
  const groupName=lesson.group_id?assignment.roster_group_names?.[lesson.group_id]:assignment.target_name_at_assignment||"Увесь потік";
  return <div className="lesson-accordion">
    <button className={`lesson-card ${open?"selected":""}`} aria-expanded={open} onClick={()=>setOpen(!open)}><span className="lesson-date">{new Date(lesson.lesson_date+"T12:00:00").toLocaleDateString("uk-UA",{day:"2-digit",month:"2-digit",year:"numeric"})}</span><strong>{lesson.topic}</strong><small>{groupName} · оцінено {graded}/{students.length} {open?"▲":"▼"}</small></button>
    {open&&<div className="lesson-accordion-body"><div className="table-wrap"><table className="unified-table mobile-stack-table"><thead><tr><th>Студент</th><th>Група</th><th>Оцінка</th><th>Відвідуваність</th></tr></thead><tbody>{students.map((student)=>{const grade=db.grades.find((item)=>item.student_id===student.user_id&&item.lesson_id===lesson.lesson_id);const attendance=db.attendance.find((item)=>item.student_id===student.user_id&&item.lesson_id===lesson.lesson_id);const status=attendance?.status==="present"?"present":attendance?.status==="absent"?`absent:${attendance.reason}`:"unmarked";return <Fragment key={student.user_id}><tr><td data-label="Студент"><strong>{student.full_name}</strong></td><td data-label="Група">{assignment.roster_group_names?.[assignment.student_group_ids?.[student.user_id]]}</td><td data-label="Оцінка"><button className={`grade-cell ${grade?"filled":"empty-cell"}`} onClick={()=>setEditing(editing===student.user_id?null:student.user_id)}>{grade?`${grade.value} / ${lesson.max_score||100}`:"Оцінити"}</button></td><td data-label="Відвідуваність"><select aria-label={`Відвідуваність ${student.full_name}, ${lesson.topic}`} value={status} disabled={busy||locked||!attendance} onChange={(event)=>{const [next,reason]=event.target.value.split(":");if(next!=="unmarked")onAction(`/attendance/${attendance.attendance_id}`,"PATCH",{status:next,reason:reason||undefined},"Відвідуваність збережено.");}}><option value="unmarked" disabled>Не позначено</option><option value="present">Присутній</option><option value="absent:поважна">Пропуск · поважна</option><option value="absent:неповажна">Пропуск · неповажна</option></select></td></tr>{editing===student.user_id&&<tr className="inline-editor-row"><td colSpan={4}><InlineGradeEditor grade={grade} lesson={lesson} student={student} busy={busy} locked={locked} onClose={()=>setEditing(null)} onSave={(path,method,body)=>onAction(path,method,body,locked?"Запит на виправлення подано деканату.":"Оцінку збережено.")}/></td></tr>}</Fragment>})}</tbody></table></div>
      {!students.length&&<div className="empty"><h3>Студентів для заняття немає</h3></div>}</div>}
  </div>;
}
