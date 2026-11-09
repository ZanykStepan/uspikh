import { useState } from "react";
import Modal from "./Modal";
import { request } from "../api";

const example = "ПІБ; пошта; група\nПетренко Іван Олегович; ivan.petrenko@pnu.edu.ua; ІПЗ-41";

export default function ImportStudents({ onClose, onDone }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (dryRun) => {
    setBusy(true);
    setError("");
    try {
      const data = await request("/users/import", { method: "POST", body: { csv, dry_run: dryRun } });
      setResult(data);
      if (!dryRun) onDone(data.message);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  const readFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setCsv(String(reader.result)); setResult(null); };
    reader.readAsText(file, "utf-8");
  };

  return <Modal title="Імпорт студентів із CSV" onClose={onClose} busy={busy}>
    <p className="muted">Кожен рядок: ПІБ; університетська пошта; назва групи. Роздільник — «;» або «,». Спочатку виконайте перевірку: дані зберігаються лише після підтвердження й лише тоді, коли в усіх рядках немає помилок.</p>
    <label>Файл CSV<input type="file" accept=".csv,text/csv,text/plain" onChange={readFile}/></label>
    <label>Або вставте рядки<textarea rows={7} value={csv} placeholder={example} onChange={(event) => { setCsv(event.target.value); setResult(null); }}/></label>
    {error && <p className="error" role="alert">{error}</p>}
    {result && <div className="table-wrap">
      <p className={result.errors ? "error" : "muted"}>{result.message} Рядків: {result.total}, без помилок: {result.valid}.</p>
      <table className="mobile-stack-table"><thead><tr><th>Рядок</th><th>ПІБ</th><th>Пошта</th><th>Група</th><th>Результат</th></tr></thead>
        <tbody>{result.rows.map((row) => <tr key={row.line}><td data-label="Рядок">{row.line}</td><td data-label="ПІБ">{row.full_name}</td><td data-label="Пошта">{row.email}</td><td data-label="Група">{row.group}</td><td data-label="Результат">{row.status === "ok" ? "Готово до імпорту" : row.message}</td></tr>)}</tbody></table>
    </div>}
    <div className="modal-actions">
      <button type="button" onClick={onClose}>Закрити</button>
      <button type="button" disabled={busy || !csv.trim()} onClick={() => run(true)}>Перевірити</button>
      <button type="button" className="primary" disabled={busy || !result || result.errors || !result.dry_run} onClick={() => run(false)}>Імпортувати</button>
    </div>
  </Modal>;
}
