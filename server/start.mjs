import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createApi } from "./api.mjs";
const demoToday = process.env.DEMO_TODAY;
if (demoToday && !/^\d{4}-\d{2}-\d{2}$/.test(demoToday)) {
  console.error("DEMO_TODAY має мати формат РРРР-ММ-ДД, наприклад 2027-07-05.");
  process.exit(1);
}
if (demoToday) console.log(`Демонстраційний режим: система вважає сьогоднішньою датою ${demoToday}. Дані зберігаються окремо.`);
const api = createApi(process.env.DATA_FILE || "server/data.json", { today: demoToday }),
  root = resolve("dist"),
  initialPort = Number(process.env.PORT || 4173);
let port = initialPort;
const server = http.createServer((req, res) =>
    api(req, res, async () => {
      const pathname = new URL(req.url, "http://localhost").pathname;
      const file = resolve(
        root,
        "." + decodeURIComponent(pathname === "/" ? "/index.html" : pathname),
      );
      if (!file.startsWith(root + "/")) {
        res.writeHead(403);
        return res.end();
      }
      try {
        const bytes = await readFile(file);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader(
          "Content-Type",
          {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
          }[extname(file)] || "application/octet-stream",
        );
        res.end(bytes);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    }),
  );
server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && !process.env.PORT && port < 4180) {
    port += 1;
    server.listen(port, "127.0.0.1");
    return;
  }
  console.error(error.code === "EADDRINUSE" ? `Порт ${port} зайнятий. Зупиніть попередній запуск «Успіху» або вкажіть інший PORT.` : `Не вдалося запустити «Успіх»: ${error.message}`);
  process.exitCode = 1;
});
server.on("listening", () => console.log(`Успіх: http://127.0.0.1:${port}`));
server.listen(port, "127.0.0.1");
