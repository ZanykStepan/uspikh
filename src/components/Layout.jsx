import { LayoutDashboard, BookOpen, BarChart3, TriangleAlert, Layers, Bell, Sun, Moon, Shield, Menu, X, Users, ClipboardList, CalendarDays, LogOut, GraduationCap, KeyRound } from "lucide-react";
import { useState } from "react";
import { visibleSemesters } from "../semesterOptions";

const labels = {
  overview: ["Огляд", LayoutDashboard], journal: ["Журнал занять", BookOpen],
  stats: ["Статистика", BarChart3],
  debts: ["Заборгованості", TriangleAlert], electives: ["Вибіркові дисципліни", Layers],
  notifications: ["Сповіщення", Bell], group: ["Мої групи", Users],
  applications: ["Заявки студентів", ClipboardList], accounts: ["Облікові записи", Users],
  disciplines: ["Дисципліни", BookOpen], groups: ["Групи", Users], streams: ["Потоки", Layers],
  semesters: ["Семестри", CalendarDays], elective_limits: ["Ліміти вибіркових", Layers], cohorts: ["Курси й роки", CalendarDays], audit: ["Журнал аудиту", Shield],
  semester_scores: ["Семестрові бали", GraduationCap], progression: ["Переведення курсу", GraduationCap], graduations: ["Завершення навчання", GraduationCap],
  records: ["Успішність студентів", BarChart3],
  corrections: ["Виправлення оцінок", ClipboardList],
};
export const roleRoutes = {
  student: ["overview", "journal", "semester_scores", "stats", "debts", "electives", "notifications"],
  teacher: ["overview", "journal", "semester_scores", "stats", "corrections", "notifications"],
  curator: ["overview", "group", "semester_scores", "debts", "notifications"],
  dean: ["overview", "records", "semester_scores", "debts", "corrections", "applications", "accounts", "disciplines", "groups", "streams", "elective_limits", "cohorts", "progression", "graduations", "audit", "notifications"],
  admin: ["overview", "semester_scores", "accounts", "disciplines", "groups", "streams", "semesters", "elective_limits", "cohorts", "progression", "graduations", "audit", "notifications"],
};
export const roleNames = { student: "Студент", teacher: "Викладач", curator: "Куратор", dean: "Деканат", admin: "Адміністратор" };
export function allowedPage(role, page) { return (roleRoutes[role] || []).includes(page); }

export default function Layout({ children, page, go, theme, setTheme, onLogout, onRoleChange, onPassword, userId, semester, setSemester, db }) {
  const [open, setOpen] = useState(false);
  const role = db?.me?.role;
  const unread = db?.notifications?.filter((n) => !n.is_read).length || 0;
  const displayName = db?.me?.full_name || roleNames[role] || "";
  const nav = (roleRoutes[role] || []).map((id) => {
    const [label, Icon] = labels[id];
    return <button key={id} className={page === id ? "nav-item active" : "nav-item"} onClick={() => { go(id); setOpen(false); }} aria-current={page === id ? "page" : undefined}>
      <Icon size={19}/><span>{label}</span>
      {id === "debts" && db?.debts?.some((d) => d.status === "open") && <i className="nav-count">{db.debts.filter((d) => d.status === "open").length}</i>}
    </button>;
  });
  return <div className="app">
    <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>До основного вмісту</a>
    <aside className={open ? "sidebar expanded" : "sidebar"}>
      <div className="brand"><img className="brand-desktop" src="/brand/uspikh-desktop.svg" alt="Успіх"/><span className="brand-caption">Електронний журнал</span><button className="mobile-only icon-button" onClick={() => setOpen(false)} aria-label="Закрити меню"><X/></button></div>
      <div className="workspace"><span className="uni-mark">КНУ</span><div>Карпатський національний<small>Університет ім. В. Стефаника</small></div></div>
      <p className="eyebrow">{role === "student" ? "НАВЧАЛЬНИЙ ПРОСТІР" : "РОБОЧИЙ ПРОСТІР"}</p>
      {db?.me?.roles?.length>1&&<label className="sidebar-role">Активна роль<select aria-label="Активна роль у меню" value={role} onChange={(event)=>{onRoleChange(event.target.value);setOpen(false);}}>{db.me.roles.map((item)=><option key={item} value={item}>{roleNames[item]}</option>)}</select></label>}
      <nav aria-label="Основне меню">{nav}</nav>
      <div className="sidebar-bottom"><div className="help-card"><span>{roleNames[role] || ""}</span><p>{role === "teacher" ? "Заняття, оцінки та відвідуваність ваших груп." : role === "student" ? "Оцінки, прогрес і вибір дисциплін." : role === "curator" ? "Успішність і заборгованості груп." : role === "dean" ? "Факультет, результати та заявки студентів." : "Довідники, облікові записи та аудит."}</p></div><div className="profile"><div className="profile-text"><strong>{displayName}</strong><small>{roleNames[role] || ""}</small></div><button className="icon-button profile-key" title="Резервний пароль" aria-label="Резервний пароль" onClick={onPassword}><KeyRound size={16}/></button></div></div>
    </aside>
    <div className="shell"><header className="topbar"><button className="mobile-only icon-button" aria-label="Відкрити меню" onClick={() => setOpen(true)}><Menu/></button><img className="brand-mobile" src="/brand/uspikh-mobile.svg" alt="Успіх"/><div className="breadcrumb">Успіх <span>/</span> <strong>{labels[page]?.[0] || "Огляд"}</strong></div><div className="top-actions">{db?.me?.roles?.length>1&&<select className="role-switch" aria-label="Активна роль" value={role} onChange={(e)=>onRoleChange(e.target.value)}>{db.me.roles.map((item)=><option key={item} value={item}>{roleNames[item]}</option>)}</select>}<select aria-label="Навчальний семестр" value={semester} onChange={e=>setSemester(Number(e.target.value))}>{visibleSemesters(db).map((s)=><option key={s.semester_id} value={s.semester_id}>{s.term_number} семестр · {s.academic_year}</option>)}</select><button className="icon-button" aria-label={theme === "dark" ? "Увімкнути світлу тему" : "Увімкнути темну тему"} onClick={()=>setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={20}/> : <Moon size={20}/>}</button><button className="icon-button notification-button" aria-label="Сповіщення" onClick={()=>go("notifications")}><Bell size={20}/>{unread>0 && <i className="count">{unread>9?"9+":unread}</i>}</button><button className="icon-button" aria-label="Вийти" onClick={onLogout}><LogOut size={19}/></button></div></header>
      <main id="main" tabIndex="-1">{children}</main><footer>Успіх — електронний журнал успішності студентів</footer></div>
  </div>;
}
