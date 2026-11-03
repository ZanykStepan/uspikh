import { useState } from "react";
import StudentRecordCard from "./StudentRecordCard";
import { scoreBreakdown } from "../domain";

export default function DeanRecords({ db }) {
  const [groupId,setGroupId]=useState(db.groups[0]?.group_id||0);
  const [groupSearch,setGroupSearch]=useState("");
  const [studentSearch,setStudentSearch]=useState("");
  const group=db.groups.find((item)=>item.group_id===groupId)||db.groups[0];
  const groups=db.groups.filter((item)=>item.group_id===group?.group_id||`${item.name} ${item.specialty} ${item.admission_year}`.toLocaleLowerCase("uk").includes(groupSearch.trim().toLocaleLowerCase("uk")));
  const students=db.users.filter((user)=>user.roles?.includes("student")&&user.group_id===group?.group_id).sort((a,b)=>a.full_name.localeCompare(b.full_name,"uk"));
  const shownStudents=students.filter((student)=>student.full_name.toLocaleLowerCase("uk").includes(studentSearch.trim().toLocaleLowerCase("uk")));
  const debts=db.debts.filter((debt)=>students.some((student)=>student.user_id===debt.student_id)&&debt.status==="open");
  const belowThreshold=students.filter((student)=>db.teaching_assignments.some((assignment)=>assignment.roster_student_ids?.includes(student.user_id)&&Number(assignment.student_group_ids?.[student.user_id])===group?.group_id&&((result)=>result.scheme&&result.semesterScore<50)(scoreBreakdown(db,assignment,student.user_id)))).length;
  return <>
    <div className="page-heading"><div><p className="eyebrow">ДЕКАНАТ · {db.me.faculty}</p><h1>Успішність студентів</h1><p className="muted">Оберіть групу, знайдіть студента й розгорніть дисципліни. Оцінки доступні лише для перегляду.</p></div></div>
    <div className="toolbar"><label className="field-inline">Пошук групи<input type="search" aria-label="Пошук групи деканату" placeholder="Назва або спеціальність" value={groupSearch} onChange={(event)=>setGroupSearch(event.target.value)}/></label><label className="field-inline">Група<select aria-label="Група деканату" value={group?.group_id||""} onChange={(event)=>setGroupId(Number(event.target.value))}>{groups.map((item)=><option key={item.group_id} value={item.group_id}>{item.name} · {item.course} курс · вступ {item.admission_year}</option>)}</select></label><label className="field-inline">Пошук студента<input type="search" aria-label="Пошук студента деканату" placeholder="ПІБ студента" value={studentSearch} onChange={(event)=>setStudentSearch(event.target.value)}/></label></div>
    <div className="stats-grid"><section className="stat"><div className="stat-label">Студенти</div><strong>{students.length}</strong><small>{group?.name||"Група"}</small></section><section className="stat"><div className="stat-label">Потребують уваги</div><strong>{belowThreshold}</strong><small>Є попередній бал нижче 50</small></section><section className="stat"><div className="stat-label">Відкриті борги</div><strong>{debts.length}</strong><small>У студентів групи</small></section></div>
    <section className="panel record-list">{shownStudents.map((student)=><StudentRecordCard key={student.user_id} db={db} student={student} groupId={group.group_id}/>)}{!students.length&&<div className="empty"><h3>У групі немає студентів</h3></div>}{students.length>0&&!shownStudents.length&&<div className="empty"><h3>Студента не знайдено</h3></div>}</section>
  </>;
}
