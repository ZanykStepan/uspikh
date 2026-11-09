export function listenNotifications(onNotification) {
  let stopped = false;
  let controller = null;

  async function connect() {
    const token = sessionStorage.getItem("uspikh-token");
    if (!token) return;
    controller = new AbortController();
    const response = await fetch("/api/notifications/stream", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error("stream");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const name = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (name === "notification" && data) onNotification(JSON.parse(data));
      }
    }
  }

  (async () => {
    while (!stopped) {
      try { await connect(); } catch { /* повторне підключення нижче */ }
      if (!stopped) await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  })();

  return () => {
    stopped = true;
    controller?.abort();
  };
}
