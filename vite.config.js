import { defineConfig } from "vite";
import { createApi } from "./server/api.mjs";

const target = process.env.VITE_API_TARGET;

export default defineConfig({
  esbuild: { jsx: "automatic" },
  server: target ? { proxy: { "/api": { target, changeOrigin: false } } } : undefined,
  plugins: target ? [] : [
    {
      name: "uspikh-mock-api",
      configureServer(server) {
        server.middlewares.use(createApi("server/data.json"));
      },
    },
  ],
});
