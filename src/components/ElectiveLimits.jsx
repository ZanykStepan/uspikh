import { useState } from "react";
import Modal from "./Modal";

const fields = [["catalog1_credits", "Каталог 1 · кредити", 60], ["catalog2_credits", "Каталог 2 · кредити", 60], ["max_disciplines", "Усього вибіркових дисциплін", 30]];

function LimitEditor({ group, current, busy, onClose, onSave }) {
  const [values, setValues] = useState(Object.fromEntries(fields.map(([key]) => [key, String(current[key])])));
  const [error, setError] = useState("");
  return <Modal title={`Ліміти вибіркових: ${group.name}`} onClose={onClose} busy={busy}><form onSubmit={async (event) => {
    event.preventDefault();
    const body = { group_id: group.group_id };
    for (const [key, label, max] of fields) {
      const number = Number(values[key]);
      if (values[key].trim() === "" || !Number.isInteger(number) || number < 0 || number > max) { setError(`«${label}»: ціле число від 0 до ${max}.`); return; }
      body[key] = number;
    }
    const ok = await onSave(body);
    if (!ok) setError("Не вдалося зберегти. Перевірте повідомлення на сторінці.");
  }}>
    <p className="muted">Кредити каталогів 1 і 2 та загальна кількість дисциплін діють на весь період навчання студентів цієї групи. Каталог 3 обмежується лише загальною кількістю.</p>
    {fields.map(([key, label, max]) => <label key={key}>{label}<input type="number" min="0" max={max} step="1" value={values[key]} onChange={(event) => setValues((state) => ({ ...state, [key]: event.target.value }))}/></label>)}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" onClick={onClose}>Скасувати</button><button className="primary" disabled={busy}>{busy ? "Збереження…" : "Зберегти"}</button></div>
  </form></Modal>;
}

export default function ElectiveLimits({ db, busy, onAction }) {
  const [editing, setEditing] = useState(null);
  const groups = db.groups.filter((group) => group.status === "active");
  const limitsFor = (groupId) => ({ ...db.elective_defaults, ...(db.elective_limits.find((item) => item.group_id === groupId) || {}) });
  return <>
    <div className="page-heading"><div><p className="eyebrow">{db.me.role === "dean" ? `ДОВІДНИКИ · ${db.me.faculty}` : "ДОВІДНИКИ СИСТЕМИ"}</p><h1>Ліміти вибіркових</h1><p className="muted">Скільки кредитів студенти групи можуть обрати в каталогах 1 і 2 та скільки вибіркових дисциплін загалом. Пропозиція «за замовчуванням» — {db.elective_defaults.catalog1_credits} і {db.elective_defaults.catalog2_credits} кредитів, до {db.elective_defaults.max_disciplines} дисциплін.</p></div></div>
    <section className="panel"><div className="table-wrap"><table className="mobile-stack-table"><thead><tr><th>Група</th><th>Курс</th><th>Каталог 1, кр.</th><th>Каталог 2, кр.</th><th>Усього дисциплін</th><th>Дія</th></tr></thead><tbody>{groups.map((group) => { const limits = limitsFor(group.group_id); const custom = db.elective_limits.some((item) => item.group_id === group.group_id); return <tr key={group.group_id}><td data-label="Група"><strong>{group.name}</strong>{!custom && <small> · типові</small>}</td><td data-label="Курс">{group.course}</td><td data-label="Каталог 1, кр.">{limits.catalog1_credits}</td><td data-label="Каталог 2, кр.">{limits.catalog2_credits}</td><td data-label="Усього дисциплін">{limits.max_disciplines}</td><td data-label="Дія"><button onClick={() => setEditing(group)}>Змінити</button></td></tr>; })}</tbody></table></div>{!groups.length && <div className="empty"><h3>Активних груп немає</h3></div>}</section>
    {editing && <LimitEditor group={editing} current={limitsFor(editing.group_id)} busy={busy} onClose={() => setEditing(null)} onSave={async (body) => { const ok = await onAction("/elective_limits", "POST", body, "Ліміти вибіркових збережено."); if (ok) setEditing(null); return ok; }}/>}
  </>;
}
