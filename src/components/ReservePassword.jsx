import { useState } from "react";
import { KeyRound } from "lucide-react";
import { request } from "../api";
export default function ReservePassword({ user }) {
  const [issued, setIssued] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const issue = async () => {
    if (!window.confirm(`Видати новий тимчасовий пароль для ${user.email}? Попередній пароль і всі активні сеанси користувача буде скасовано.`)) return;
    setBusy(true); setError("");
    try { setIssued(await request(`/admin/users/${user.user_id}/reserve-password`, { method: "POST" })); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const unlock = async () => {
    setBusy(true); setError("");
    try { await request(`/admin/users/${user.user_id}/unlock`, { method: "POST" }); setError("Блокування знято."); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return <fieldset className="assignment-fieldset">
    <legend>Резервний вхід</legend>
    <p className="muted">Основний вхід — через корпоративну пошту. Тимчасовий пароль потрібен, лише якщо користувач не може нею скористатися. Передайте його особисто; при першому вході користувач змінить його сам.</p>
    {issued && <div className="temp-password" role="status"><span>Тимчасовий пароль (показується один раз, діє {issued.expires_in_hours} год)</span><code>{issued.password}</code></div>}
    {error && <p className="muted" role="status">{error}</p>}
    <div className="row-actions"><button type="button" disabled={busy} onClick={issue}><KeyRound size={15}/> Видати тимчасовий пароль</button><button type="button" disabled={busy} onClick={unlock}>Зняти блокування</button></div>
  </fieldset>;
}
