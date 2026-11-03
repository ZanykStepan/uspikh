import { defineConfig } from "vite";
import { createApi } from "./server/api.mjs";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  plugins: [
    {
      name: "uspikh-mock-api",
      configureServer(server) {
        server.middlewares.use(createApi("server/data.json"));
      },
    },
  ],
});
