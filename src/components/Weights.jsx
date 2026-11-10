import { useState } from "react";
import Modal from "./Modal";
import { lessonTypes, scoreBreakdown, weightScheme } from "../domain";

export function WeightSummary({ db, assignment, studentId, onEdit, discipline }) {
  const result = studentId == null ? null : scoreBreakdown(db, assignment, studentId);
  const scheme = result?.scheme || weightScheme(db, assignment);
  const shown = lessonTypes.filter((type) => scheme?.weights[type] > 0);
  const average = scheme?.method === "average";
  return <section className="panel weight-summary">
    <div className="panel-head"><div><p className="eyebrow">ПРАВИЛА ОЦІНЮВАННЯ</p><h2>{average ? "Метод розрахунку" : "Ваги типів занять"}</h2></div><div className="weight-summary-actions">{result?.scheme && <strong className="weight-score">{String(result.semesterScore).replace(".", ",")} / 100</strong>}{onEdit && <button onClick={onEdit}>{scheme ? "Змінити ваги" : "Установити ваги"}</button>}</div></div>
    {!scheme ? <p className="muted">Семестровий бал не обчислюється: викладач ще не встановив ваги.</p> : <>
      <div className="weight-chips">{average ? <span className="weight-chip">Простий середній бал усіх оцінених занять</span> : shown.map((type) => <span className="weight-chip" key={type}>{type} <strong>{scheme.weights[type]}%</strong></span>)}</div>
      {result && <details className="weight-details"><summary>Як обчислено попередній бал</summary><p className="muted">{average ? "Бал — середнє всіх внесених оцінок, переведених у шкалу 0–100. Ваги типів занять не використовуються." : "Середнє внесених оцінок кожного типу переводиться у шкалу 0–100 та множиться на його вагу. Тип без оцінок дає 0. Проміжні значення округлено лише для показу."}</p><div className="weight-grid">{(average ? lessonTypes.filter((t) => result?.types.find((row) => row.type === t)?.count) : shown).map((type) => {
        const item = result?.types.find((row) => row.type === type);
        return <div className="weight-item" key={type}><strong>{type}</strong>{item && <small>{average ? `Середнє ${item.mean} · оцінок ${item.count}` : item.count ? `Середнє ${item.mean} · внесок ${item.contribution}` : "Оцінок немає · внесок 0"}</small>}</div>;
      })}</div></details>}
    </>}
    {discipline && <div className="weight-discipline"><h3>Про дисципліну</h3><p>{discipline.description?.trim() || "Опис ще не додано. Його може заповнити викладач дисципліни."}</p>{discipline.syllabus_url && <a href={discipline.syllabus_url} target="_blank" rel="noopener noreferrer">Відкрити силабус ↗</a>}</div>}
  </section>;
}

export function WeightEditor({ db, assignment, busy, serverError, onClose, onSave }) {
  const scheme = weightScheme(db, assignment);
  const [weights, setWeights] = useState(Object.fromEntries(lessonTypes.map((type) => [type, scheme?.weights[type] ?? 0])));
  const [method, setMethod] = useState(scheme?.method || "weighted");
  const [error, setError] = useState("");
  const sum = Object.values(weights).reduce((total, value) => total + Number(value || 0), 0);
  const course = assignment.course_at_assignment;
  return <Modal title="Ваги оцінювання" className="weight-dialog" onClose={onClose} busy={busy}><form onSubmit={async (event) => {
    event.preventDefault();
    const clean = Object.fromEntries(lessonTypes.map((type) => [type, Number(weights[type])]));
    if (method === "weighted" && (Object.values(clean).some((value) => !Number.isInteger(value) || value < 0 || value > 100) || sum !== 100)) { setError("Установіть цілі ваги від 0 до 100. Сума має дорівнювати 100%."); return; }
    const ok = await onSave({ discipline_id: assignment.discipline_id, semester_id: assignment.semester_id, course, method, weights: clean });
    if (!ok) setError("");
  }}><p className="muted">До завершення семестру ваги можна змінювати. Нові ваги одразу перерахують попередній бал усіх студентів цієї дисципліни й курсу.</p>
    <label>Метод розрахунку<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="weighted">За вагами типів занять</option><option value="average">Простий середній бал усіх занять</option></select></label>
    {method === "weighted" && <><div className="weight-fields">{lessonTypes.map((type) => <label key={type}>{type}<input type="number" min="0" max="100" step="1" value={weights[type]} onChange={(event) => setWeights((current) => ({ ...current, [type]: event.target.value }))}/><span>%</span></label>)}</div>
    <p className={sum === 100 ? "sum-valid" : "error"}>Разом: {sum}% із 100%</p></>}
    {(error || serverError) && <p className="error" role="alert">{error || serverError}</p>}
    <div className="modal-actions"><button type="button" onClick={onClose}>Скасувати</button><button className="primary" disabled={busy}>{busy ? "Збереження…" : "Зберегти ваги"}</button></div>
  </form></Modal>;
}
