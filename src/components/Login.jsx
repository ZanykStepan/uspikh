import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, LockKeyhole } from "lucide-react";
import { request } from "../api";

const accounts = [
  ["Студент", "demo1@pnu.edu.ua"], ["Викладач", "demo7@pnu.edu.ua"],
  ["Куратор", "demo9@pnu.edu.ua"], ["Деканат", "demo11@pnu.edu.ua"],
  ["Адміністратор", "demo10@pnu.edu.ua"],
];

export default function Login({ onLogin, theme, setTheme }) {
  const [email, setEmail] = useState(accounts[0][1]);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState({ google: false, reserve: true });
  const [reserveOpen, setReserveOpen] = useState(false);
  useEffect(() => {
    const message = sessionStorage.getItem("uspikh-login-error");
    if (message) { sessionStorage.removeItem("uspikh-login-error"); setError(message); }
    request("/auth/options").then(setOptions).catch(() => {});
  }, []);
  const showReserve = options.reserve && (reserveOpen || !options.google);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try { onLogin(await request("/auth/login", { method: "POST", body: { email, password } })); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return <main className="login-page">
    <div className="login-brand"><img src="/brand/uspikh-desktop.svg" alt="Успіх"/><span>Електронний журнал <br/>Карпатського національного університету імені Василя Стефаника</span></div>
    <section className="login-card">
      <div className="login-icon"><BookOpen size={22}/></div>
      <p className="eyebrow">НАВЧАЛЬНИЙ ПРОСТІР</p>
      <h1>Вхід до системи</h1>
      {options.google && <>
        <p className="muted">Увійдіть за допомогою університетської пошти.</p>
        <a className="corp-login" href="/api/auth/google/start">
          <img src="/brand/corporate-mail-login.svg" alt="" width="44" height="44"/>
          <span><strong>Увійти через корпоративну пошту</strong><small>@pnu.edu.ua · @cnu.edu.ua</small></span>
        </a>
      </>}
      {error && <p className="error" role="alert">{error}</p>}
      {options.google && options.reserve && <button type="button" className="reserve-toggle" aria-expanded={showReserve} onClick={() => { setReserveOpen(!reserveOpen); setError(""); }}>
        Немає доступу до корпоративної пошти? Резервний вхід <ChevronDown size={14} className={showReserve ? "open" : ""}/>
      </button>}
      {showReserve && <div className="reserve-box">
        {!options.google && <p className="muted">Використайте університетську електронну пошту та пароль.</p>}
        <form onSubmit={submit}>
          <label>Університетська пошта<input type="email" autoComplete="username" required pattern=".+@(pnu|cnu)\.edu\.ua" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@pnu.edu.ua"/></label>
          <label>Резервний пароль<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Введіть пароль"/></label>
          <button className={options.google ? "reserve-submit" : "primary login-submit"} disabled={busy}><LockKeyhole size={16}/>{busy ? "Входимо…" : "Увійти за паролем"}</button>
        </form>
        <div className="login-demo"><strong>Навчальна демонстрація</strong><p>Оберіть профіль. Для кожного використовується пароль <code>Demo2026!</code>.</p><div className="login-accounts">{accounts.map(([name, address]) => <button type="button" className={email === address ? "active" : ""} key={address} onClick={() => { setEmail(address); setError(""); }}>{name}</button>)}</div></div>
      </div>}
      {!options.google && <p className="login-note">Вхід через корпоративну пошту вмикається на сервері змінними GOOGLE_CLIENT_ID і GOOGLE_CLIENT_SECRET.</p>}
    </section>
    <button className="login-theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? "Темна тема" : "Світла тема"}</button>
  </main>;
}
