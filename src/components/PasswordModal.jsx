import { useEffect, useState } from "react";
import Modal from "./Modal";
import { request } from "../api";
export default function PasswordModal({ forced = false, onClose, onDone }) {
  const [status, setStatus] = useState(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { request("/auth/security").then(setStatus).catch(() => setStatus({ has_password: true })); }, []);
  const submit = async (event) => {
    event.preventDefault(); setError("");
    if (next !== repeat) { setError("Паролі не збігаються."); return; }
    setBusy(true);
    try { await request("/auth/password", { method: "POST", body: { current_password: current, new_password: next } }); setSaved(true); onDone?.(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return <Modal title={saved ? "Пароль збережено" : forced ? "Змініть тимчасовий пароль" : "Резервний пароль"} onClose={forced && !saved ? () => {} : onClose} busy={busy}>
    {saved ? <><p>Резервний пароль збережено. Ним можна входити, якщо корпоративна пошта недоступна.</p><div className="modal-actions"><button className="primary" onClick={onClose}>Готово</button></div></> :
    <form onSubmit={submit}>
      <p className="muted">{forced ? "Адміністратор видав вам тимчасовий пароль. Встановіть власний, щоб продовжити." : status?.has_password ? "Змініть пароль для входу без корпоративної пошти." : "Пароль потрібен лише для резервного входу, якщо корпоративна пошта недоступна. Основний вхід — через пошту."}</p>
      {status?.has_password && <label>{forced ? "Тимчасовий пароль" : "Поточний пароль"}<input type="password" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)}/></label>}
      <label>Новий пароль<input type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(event) => setNext(event.target.value)} placeholder="Не менше 10 символів, літери й цифри"/></label>
      <label>Повторіть новий пароль<input type="password" autoComplete="new-password" required value={repeat} onChange={(event) => setRepeat(event.target.value)}/></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">{!forced && <button type="button" onClick={onClose}>Скасувати</button>}<button className="primary" disabled={busy || !status}>{busy ? "Збереження…" : "Зберегти пароль"}</button></div>
    </form>}
  </Modal>;
}
