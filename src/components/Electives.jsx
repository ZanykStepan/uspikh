import { Layers } from "lucide-react";
import { formatDate } from "../format";
import { todayKyiv } from "../domain";

const statusNames = { pending: "Очікує", approved: "Підтверджено", rejected: "Відхилено" };
const catalogNames = { 1: "Каталог 1", 2: "Каталог 2", 3: "Каталог 3" };

function Meter({ label, used, limit, note }) {
  const percent = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 100;
  return <div className="elective-meter"><div><strong>{label}</strong><span>{used} із {limit}</span></div><div className="progress-track"><i style={{ width: percent + "%" }}/></div>{note && <small>{note}</small>}</div>;
}

// Причина, з якої нова заявка неможлива зараз (сервер перевіряє те саме).
function blockedReason(db, discipline, offering) {
  const today = todayKyiv();
  if (today < discipline.enrollment_start) return "Запис ще не розпочався";
  if (today > discipline.enrollment_deadline) return "Запис завершено";
  if (offering.taken >= discipline.capacity) return "Місця вичерпано";
  const limits = db.my_elective_limits, usage = db.elective_usage;
  if (usage.total >= limits.max_disciplines) return "Досягнуто загальний ліміт дисциплін";
  if (discipline.catalog === 1 && usage.catalog1_credits + discipline.credits > limits.catalog1_credits) return "Перевищено ліміт кредитів 1 каталогу";
  if (discipline.catalog === 2 && usage.catalog2_credits + discipline.credits > limits.catalog2_credits) return "Перевищено ліміт кредитів 2 каталогу";
  return "";
}

export default function Electives({ db, choices, busy, onAction }) {
  const limits = db.my_elective_limits, usage = db.elective_usage;
  return <>
    <div className="page-heading"><div><p className="eyebrow">ІНДИВІДУАЛЬНА ТРАЄКТОРІЯ</p><h1>Вибіркові дисципліни</h1><p className="muted">Пропозиції цього навчального року для вашої групи або потоку. Заявку погоджує деканат; заявки, що очікують, теж входять до лімітів.</p></div></div>
    <section className="panel elective-limits-panel">
      <div className="panel-head"><div><h2>Ваші ліміти</h2><p>Кредити каталогів 1 і 2 та загальна кількість дисциплін рахуються за весь період навчання.</p></div></div>
      <div className="elective-meters">
        <Meter label="Усього дисциплін" used={usage.total} limit={limits.max_disciplines} note="Каталоги 1, 2 і 3 разом"/>
        <Meter label="Каталог 1 · кредити" used={usage.catalog1_credits} limit={limits.catalog1_credits}/>
        <Meter label="Каталог 2 · кредити" used={usage.catalog2_credits} limit={limits.catalog2_credits}/>
        <div className="elective-meter"><div><strong>Каталог 3</strong><span>без окремого ліміту</span></div><small>Обмежується лише загальною кількістю дисциплін.</small></div>
      </div>
    </section>
    {[1, 2, 3].map((catalog) => {
      const items = choices.filter(({ discipline }) => discipline.catalog === catalog);
      return <section className="elective-catalog" key={catalog} aria-label={catalogNames[catalog]}>
        <h2>{catalogNames[catalog]}</h2>
        <div className="subject-grid">{items.map(({ discipline, offering }) => {
          const enrollment = db.elective_enrollments.find((entry) => entry.discipline_id === discipline.discipline_id && entry.semester_id === offering.semester_id);
          const term = db.semesters.find((item) => item.semester_id === offering.semester_id);
          const free = Math.max(0, discipline.capacity - offering.taken);
          const reason = enrollment && enrollment.status !== "rejected" ? "" : blockedReason(db, discipline, offering);
          return <section className="panel elective-card" key={`${discipline.discipline_id}:${offering.semester_id}`}>
            <Layers/><span className="badge neutral">{catalogNames[catalog]} · {discipline.credits} кредити ЄКТС</span>
            <h2>{discipline.name}</h2>
            <p className="muted">{term?.term_number} семестр · {term?.academic_year}</p>
            <p className="muted">Запис: {formatDate(discipline.enrollment_start)} — {formatDate(discipline.enrollment_deadline)}</p>
            <p className="elective-seats"><span>Обрали: <strong>{offering.taken}</strong></span><span>Вільно: <strong>{free}</strong> із {discipline.capacity}</span></p>
            <p className="muted elective-description">{discipline.description || "Опис дисципліни ще не додано."}{discipline.syllabus_url && <a href={discipline.syllabus_url} target="_blank" rel="noopener noreferrer">Силабус ↗</a>}</p>
            {enrollment && enrollment.status !== "rejected"
              ? <div className="row-actions"><span className={"badge " + enrollment.status}>{statusNames[enrollment.status]}</span>{enrollment.status === "pending" && <button disabled={busy} onClick={() => onAction("/elective_enrollments/" + enrollment.enrollment_id, "DELETE", undefined, "Заявку скасовано.")}>Скасувати заявку</button>}</div>
              : <div className="row-actions">{enrollment?.status === "rejected" && <span className="badge rejected">{statusNames.rejected}</span>}{reason ? <span className="badge neutral">{reason}</span> : <button className="primary" disabled={busy} onClick={() => onAction("/elective_enrollments", "POST", { discipline_id: discipline.discipline_id, semester_id: offering.semester_id }, "Заявку подано.")}>{enrollment?.status === "rejected" ? "Подати заявку знову" : "Подати заявку"}</button>}</div>}
          </section>;
        })}</div>
        {!items.length && <p className="muted">У цьому каталозі для вашої групи пропозицій поки немає.</p>}
      </section>;
    })}
    {!choices.length && <div className="empty"><Layers/><h3>Для вашої групи вибіркових пропозицій поки немає</h3><p>Після закріплення дисципліни за групою або потоком вона з’явиться тут.</p></div>}
  </>;
}
