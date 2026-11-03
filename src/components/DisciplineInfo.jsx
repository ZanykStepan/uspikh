import { useState } from "react";
import Modal from "./Modal";

export default function DisciplineInfo({ discipline, onEdit }) {
  if (!discipline) return null;
  return <section className="panel discipline-info"><div className="panel-head"><div><p className="eyebrow">ПРО ДИСЦИПЛІНУ</p><h2>Опис і матеріали</h2></div>{onEdit&&<button type="button" onClick={onEdit}>Редагувати</button>}</div><div className="discipline-info-body"><p>{discipline.description || "Опис дисципліни ще не додано."}</p>{discipline.syllabus_url&&<a href={discipline.syllabus_url} target="_blank" rel="noopener noreferrer">Відкрити силабус ↗</a>}</div></section>;
}

export function DisciplineDetailsEditor({ discipline, busy, onClose, onSave }) {
  const [description,setDescription]=useState(discipline.description || "");
  const [syllabusUrl,setSyllabusUrl]=useState(discipline.syllabus_url || "");
  const [error,setError]=useState("");
  return <Modal title={`Опис дисципліни: ${discipline.name}`} onClose={onClose} busy={busy}><form onSubmit={async(event)=>{event.preventDefault();setError("");const ok=await onSave({description,syllabus_url:syllabusUrl});if(!ok)setError("Не вдалося зберегти опис. Перевірте посилання та повідомлення на сторінці.");}}><label>Опис дисципліни<textarea value={description} maxLength={2000} rows={5} onChange={(event)=>setDescription(event.target.value)} placeholder="Коротко про зміст і результати навчання"/></label><label>Посилання на силабус<input type="url" value={syllabusUrl} maxLength={2048} onChange={(event)=>setSyllabusUrl(event.target.value)} placeholder="https://..."/></label><p className="muted">Опис і посилання будуть видимі студентам у журналі та каталозі вибіркових дисциплін.</p>{error&&<p className="error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" onClick={onClose}>Скасувати</button><button className="primary" disabled={busy}>{busy?"Збереження…":"Зберегти"}</button></div></form></Modal>;
}
