import React from "react";

export default class AppErrorBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("Успіх: помилка інтерфейсу", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="recovery-page"><section className="recovery-card"><h1>Не вдалося відкрити сторінку</h1><p>Оновіть її. Якщо проблема повториться, поверніться до входу та виберіть профіль знову.</p><div className="row-actions"><button className="primary" onClick={() => location.reload()}>Оновити сторінку</button><button onClick={() => { for (const key of ["uspikh-token", "uspikh-user-id", "uspikh-semester"]) sessionStorage.removeItem(key); location.hash = "overview"; location.reload(); }}>Повернутися до входу</button></div></section></main>;
  }
}
