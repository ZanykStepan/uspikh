import { useState } from "react";
import { BookOpen, LockKeyhole } from "lucide-react";
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
  return <main className="login-page">
    <div className="login-brand"><img src="/brand/uspikh-desktop.svg" alt="Успіх"/><span>Електронний журнал <br/>Карпатського національного університету імені Василя Стефаника</span></div>
    <section className="login-card">
      <div className="login-icon"><BookOpen size={22}/></div>
      <p className="eyebrow">НАВЧАЛЬНИЙ ПРОСТІР</p>
      <h1>Вхід до системи</h1>
      <p className="muted">Використайте університетську електронну пошту та пароль.</p>
      <form onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setError("");
        try { const result = await request("/auth/login", { method: "POST", body: { email, password } }); onLogin(result); }
        catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
      }}>
        <label>Університетська пошта<input type="email" autoComplete="username" required pattern=".+@pnu\.edu\.ua" value={email} onChange={(event)=>setEmail(event.target.value)} placeholder="name@pnu.edu.ua"/></label>
        <label>Пароль<input type="password" autoComplete="current-password" required value={password} onChange={(event)=>setPassword(event.target.value)} placeholder="Введіть пароль"/></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary login-submit" disabled={busy}><LockKeyhole size={17}/>{busy ? "Входимо…" : "Увійти"}</button>
      </form>
      <div className="login-demo"><strong>Навчальна демонстрація</strong><p>Оберіть профіль. Для кожного використовується пароль <code>Demo2026!</code>.</p><div className="login-accounts">{accounts.map(([name,address])=><button type="button" className={email===address?"active":""} key={address} onClick={()=>{setEmail(address);setError("");}}>{name}</button>)}</div></div>
      <p className="login-note">Вхід через Google буде додано після інтеграції з університетським акаунтом.</p>
    </section>
    <button className="login-theme" onClick={()=>setTheme(theme==="light"?"dark":"light")}>{theme==="light"?"Темна тема":"Світла тема"}</button>
  </main>;
}
