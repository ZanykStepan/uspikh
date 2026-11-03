import { useState } from "react";
import { scoreBreakdown } from "../domain";

function DebtCard({ db, debt, busy, onAction }) {
  const [deadline,setDeadline]=useState(debt.deadline||"");
  const student=db.users.find((user)=>user.user_id===debt.student_id);
  const discipline=db.disciplines.find((item)=>item.discipline_id===debt.discipline_id);
  const semester=db.semesters.find((item)=>item.semester_id===debt.semester_id);
  const assignment=db.teaching_assignments.find((item)=>item.discipline_id===debt.discipline_id&&item.semester_id===debt.semester_id&&item.roster_student_ids?.includes(debt.student_id));
  const result=assignment?scoreBreakdown(db,assignment,debt.student_id):null;
  const examRequired=(result?.scheme?.weights?.["Екзамен"]||0)>0;
  const examGraded=assignment&&db.lessons.some((lesson)=>lesson.assignment_id===assignment.assignment_id&&lesson.lesson_type==="Екзамен"&&(!lesson.group_id||Number(assignment.student_group_ids?.[debt.student_id])===lesson.group_id)&&db.grades.some((grade)=>grade.lesson_id===lesson.lesson_id&&grade.student_id===debt.student_id));
  const canClose=debt.status==="open"&&!!debt.deadline&&result?.scheme&&result.semesterScore>=50&&(!examRequired||examGraded);
  return <article className="debt-card"><div><strong>{student?.full_name} · {discipline?.name}</strong><small>{semester?.term_number} півріччя · {semester?.academic_year} · {debt.status==="open"?"Відкрита":"Закрита"}</small><p>{debt.reason||"Причину не зазначено"}</p><small>Бал за формулою: {result?.scheme?`${result.semesterScore} / 100`:"Ваги не встановлено"}</small></div><div className="debt-actions"><label>Термін ліквідації<input type="date" min={semester?.end_date} value={deadline} disabled={debt.status==="closed"} onChange={(event)=>setDeadline(event.target.value)}/></label>{debt.status==="open"&&<><button disabled={busy||!deadline||deadline===debt.deadline} onClick={()=>onAction(`/debts/${debt.debt_id}`,"PATCH",{deadline},"Термін збережено.")}>Зберегти термін</button><button className="primary" disabled={busy||!canClose} onClick={()=>onAction(`/debts/${debt.debt_id}`,"PATCH",{status:"closed"},"Борг ліквідовано.")}>Закрити борг</button></>}{debt.status==="open"&&!canClose&&<small>Закриття доступне, коли встановлено термін, бал становить щонайменше 50 та є оцінка обов’язкового екзамену.</small>}</div></article>;
}

export default function DebtManagement({ db, busy, onAction }) {
  const [search,setSearch]=useState("");
  const [status,setStatus]=useState("open");
  const query=search.trim().toLocaleLowerCase("uk");
  const rows=db.debts.filter((debt)=>(status==="all"||debt.status===status)&&(!query||`${db.users.find((user)=>user.user_id===debt.student_id)?.full_name||""} ${db.disciplines.find((discipline)=>discipline.discipline_id===debt.discipline_id)?.name||""}`.toLocaleLowerCase("uk").includes(query)));
  return <><div className="page-heading"><div><p className="eyebrow">ДЕКАНАТ · АКАДЕМІЧНІ СПРАВИ</p><h1>Заборгованості</h1><p className="muted">Після завершення півріччя система створює борг за балом нижче 50 або відсутнім обов’язковим екзаменом. Деканат задає термін і закриває борг після виконання критеріїв.</p></div></div><div className="toolbar"><label className="field-inline">Пошук<input type="search" aria-label="Пошук заборгованостей" placeholder="Студент або дисципліна" value={search} onChange={(event)=>setSearch(event.target.value)}/></label><label className="field-inline">Статус<select value={status} onChange={(event)=>setStatus(event.target.value)}><option value="open">Відкриті</option><option value="closed">Закриті</option><option value="all">Усі</option></select></label></div><section className="panel debt-list">{rows.map((debt)=><DebtCard key={debt.debt_id} db={db} debt={debt} busy={busy} onAction={onAction}/>)}{!rows.length&&<div className="empty"><h3>Заборгованостей за фільтром немає</h3></div>}</section></>;
}
