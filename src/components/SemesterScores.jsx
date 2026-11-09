import { useState } from "react";
import { convertSemesterScore, scoreBreakdown } from "../domain";

export default function SemesterScores({ db, role, selectedGroupId }) {
  const [disciplineFilter,setDisciplineFilter]=useState(0);
  const [targetFilter,setTargetFilter]=useState("");
  const [studentFilter,setStudentFilter]=useState(0);
  const [facultyFilter,setFacultyFilter]=useState("");
  const [search,setSearch]=useState("");
  const allRows=db.teaching_assignments.flatMap((assignment)=>{
    const semester=db.semesters.find((item)=>item.semester_id===assignment.semester_id);
    const discipline=db.disciplines.find((item)=>item.discipline_id===assignment.discipline_id);
    return (assignment.roster_student_ids||[]).filter((studentId)=>role!=="student"||studentId===db.me.user_id).map((studentId)=>{
      const student=db.users.find((item)=>item.user_id===studentId);
      const groupId=Number(assignment.student_group_ids?.[studentId]);
      const group=db.groups.find((item)=>item.group_id===groupId);
      const result=scoreBreakdown(db,assignment,studentId);
      return {assignment,semester,discipline,student,groupId,groupName:assignment.roster_group_names?.[groupId]||group?.name||"—",faculty:group?.faculty,score:result.semesterScore,scale:result.gradedCount?convertSemesterScore(result.semesterScore):null};
    });
  }).filter((row)=>row.student&&row.semester&&row.discipline);
  const faculties=[...new Set(allRows.map((row)=>row.faculty).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"uk"));
  const activeFaculty=facultyFilter||faculties[0]||"";
  const facultyRows=role==="admin"&&facultyFilter?allRows.filter((row)=>row.faculty===activeFaculty):allRows;
  const disciplines=[...new Map(facultyRows.map((row)=>[row.discipline.discipline_id,row.discipline])).values()].sort((a,b)=>a.name.localeCompare(b.name,"uk"));
  const activeDiscipline=disciplineFilter||((role==="teacher")?disciplines[0]?.discipline_id:0);
  const subjectRows=facultyRows.filter((row)=>!activeDiscipline||row.discipline.discipline_id===activeDiscipline);
  const groupOptions=[...new Map(subjectRows.map((row)=>[row.groupId,row.groupName])).entries()].sort((a,b)=>a[1].localeCompare(b[1],"uk"));
  const streamOptions=role==="teacher"?[...new Map(subjectRows.filter((row)=>row.assignment.stream_id).map((row)=>[row.assignment.assignment_id,row.assignment.target_name_at_assignment||"Потік"])).entries()]:[];
  const defaultTarget=role==="curator"&&selectedGroupId?`group:${selectedGroupId}`:"all";
  const activeTarget=targetFilter||defaultTarget;
  const targetRows=subjectRows.filter((row)=>activeTarget==="all"||(activeTarget.startsWith("group:")?row.groupId===Number(activeTarget.slice(6)):row.assignment.assignment_id===Number(activeTarget.slice(7))));
  const students=[...new Map(targetRows.map((row)=>[row.student.user_id,row.student])).values()].sort((a,b)=>a.full_name.localeCompare(b.full_name,"uk"));
  const query=search.trim().toLocaleLowerCase("uk");
  const rows=targetRows.filter((row)=>(!studentFilter||row.student.user_id===studentFilter)&&(!query||`${row.student.full_name} ${row.discipline.name} ${row.groupName} ${row.faculty||""}`.toLocaleLowerCase("uk").includes(query))).sort((a,b)=>b.semester.start_date.localeCompare(a.semester.start_date)||a.discipline.name.localeCompare(b.discipline.name,"uk")||a.student.full_name.localeCompare(b.student.full_name,"uk"));
  const periods=[...new Map(rows.map((row)=>[row.semester.academic_year+":"+row.semester.term_number,{semester:row.semester,rows:[]}])).values()];
  for(const row of rows) periods.find((period)=>period.semester.semester_id===row.semester.semester_id)?.rows.push(row);
  return <>
    <div className="page-heading"><div><p className="eyebrow">ІСТОРІЯ НАВЧАННЯ</p><h1>Семестрові бали</h1><p className="muted">Результати за всі семестри. Бал з’являється лише після встановлення ваг викладачем.</p></div></div>
    {role!=="student"&&<div className="toolbar score-filters">
      {role==="admin"&&<label className="field-inline">Факультет<select aria-label="Факультет для балів" value={facultyFilter} onChange={(event)=>{setFacultyFilter(event.target.value);setDisciplineFilter(0);setTargetFilter("all");setStudentFilter(0);}}><option value="">Усі факультети</option>{faculties.map((name)=><option key={name} value={name}>{name}</option>)}</select></label>}
      <label className="field-inline">Дисципліна<select aria-label="Дисципліна для семестрових балів" value={activeDiscipline||0} onChange={(event)=>{setDisciplineFilter(Number(event.target.value));setTargetFilter("all");setStudentFilter(0);}}>{role!=="teacher"&&<option value={0}>Усі дисципліни</option>}{disciplines.map((item)=><option key={item.discipline_id} value={item.discipline_id}>{item.name}</option>)}</select></label>
      <label className="field-inline">Група або потік<select aria-label="Група або потік для балів" value={activeTarget} onChange={(event)=>{setTargetFilter(event.target.value);setStudentFilter(0);}}><option value="all">Усі групи</option>{streamOptions.map(([id,name])=><option key={`stream:${id}`} value={`stream:${id}`}>{name} · увесь потік</option>)}{groupOptions.map(([id,name])=><option key={`group:${id}`} value={`group:${id}`}>{name}</option>)}</select></label>
      <label className="field-inline">Студент<select aria-label="Студент для семестрових балів" value={studentFilter} onChange={(event)=>setStudentFilter(Number(event.target.value))}><option value={0}>Усі студенти</option>{students.map((student)=><option key={student.user_id} value={student.user_id}>{student.full_name}</option>)}</select></label>
      <label className="field-inline">Пошук<input type="search" aria-label="Пошук у семестрових балах" placeholder="Студент, дисципліна або група" value={search} onChange={(event)=>setSearch(event.target.value)}/></label>
    </div>}
    <section className={`panel semester-score-panel ${role==="student"?"student-scores":""}`}><div className="panel-head"><div><h2>{role==="student"?"Мої результати":role==="curator"?"Результати закріпленої групи":"Результати студентів"}</h2><p>Переведення в інші шкали є демонстраційним і потребує затвердження університетом.</p></div></div>
      {periods.map((period)=><div className="score-period" key={period.semester.semester_id}><h3>{period.semester.term_number} семестр · {period.semester.academic_year}</h3><div className="table-wrap score-desktop"><table><thead><tr>{role!=="student"&&<><th>Студент</th><th>Група</th></>}<th>Курс</th><th>Дисципліна</th><th>Бал за формулою</th><th>5-бальна</th><th>12-бальна</th><th>ECTS</th></tr></thead><tbody>{period.rows.map((row)=><tr key={`${row.assignment.assignment_id}-${row.student.user_id}`}>{role!=="student"&&<><td><strong>{row.student.full_name}</strong></td><td>{row.groupName}</td></>}<td>{row.assignment.course_at_assignment}</td><td>{row.discipline.name}</td><td><strong>{row.score==null?"Ваги не встановлено":`${String(row.score).replace(".",",")} / 100`}</strong></td><td>{row.scale?.five??"—"}</td><td>{row.scale?.twelve??"—"}</td><td>{row.scale?.ects??"—"}</td></tr>)}</tbody></table></div><div className="score-mobile-list">{period.rows.map((row)=><article className="score-mobile-card" key={`${row.assignment.assignment_id}-${row.student.user_id}`}><div className="score-mobile-main"><div>{role!=="student"&&<small>{row.student.full_name} · {row.groupName}</small>}<strong>{row.discipline.name}</strong><small>{row.assignment.course_at_assignment} курс</small></div><strong className="score-mobile-value">{row.score==null?"—":`${String(row.score).replace(".",",")} / 100`}</strong></div>{row.score==null?<p>Ваги не встановлено</p>:!row.scale?<p>Оцінок ще немає</p>:<div className="score-mobile-scales"><span>5-бальна <strong>{row.scale.five}</strong></span><span>12-бальна <strong>{row.scale.twelve}</strong></span><span>ECTS <strong>{row.scale.ects}</strong></span></div>}</article>)}</div></div>)}
      {!rows.length&&<div className="empty"><h3>Результатів за цими фільтрами немає</h3><p>Оберіть іншу дисципліну, групу або студента.</p></div>}
    </section>
    <p className="conversion-note">Демонстраційна таблиця: 5-бальна — 90–100 → 5, 75–89 → 4, 50–74 → 3, 35–49 → 2, 0–34 → 1; 12-бальна — округлення (бал × 12 / 100); ECTS — A від 90, B від 82, C від 75, D від 68, E від 50, FX від 35, F нижче 35. Прохідний бал — 50. Переведення не показується, поки не внесено жодної оцінки.</p>
  </>;
}
