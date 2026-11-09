import express from "express";
import helmet from "helmet";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { config } from "./config/index.js";
import { createRouter } from "./routes/index.js";
import { notFound, errorHandler } from "./middleware/errors.js";
import { createMemoryBus } from "./services/notificationBus.js";
import { createGoogleOidc } from "./services/googleOidc.js";
import { openApiDocument } from "./docs/openapi.js";

const kyivToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });

export function createApp({
  pool,
  today,
  allowDemoHeader = false,
  oidc = createGoogleOidc(),
  limitLogin = true,
  quiet = false,
  staticDir,
  bus = createMemoryBus(),
} = {}) {
  const app = express();
  const todayFn = typeof today === "function" ? today : () => today || kyivToday();
  app.locals.deps = { bus, pool, today: todayFn, allowDemoHeader, oidc, quiet, state: { reconciledOn: null } };
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(cors({ origin: config.corsOrigins, credentials: false }));
  const docsPolicy = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
      },
    },
  });
  app.use("/api/docs", docsPolicy, swaggerUi.serve, swaggerUi.setup(openApiDocument, { customSiteTitle: "Успіх — API" }));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
    }),
  );
  app.get("/api/openapi.json", (_req, res) => res.json(openApiDocument));
  app.use("/api/users/import", express.json({ limit: "512kb" }));
  app.use(
    "/api",
    express.json({ limit: "10kb" }),
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    createRouter({ limitLogin }),
  );
  if (staticDir) app.use(express.static(staticDir, { setHeaders: (res) => res.set("Cache-Control", "no-store") }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
