import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate, requireAuth } from "../middleware/authenticate.js";
import * as authController from "../controllers/authController.js";
import * as c from "../controllers/journalController.js";
import { directoryKeys } from "../services/directoryService.js";
import { fail } from "../utils/httpError.js";

const idParam = (req, _res, next) => {
  if (req.params.id !== undefined && !/^\d{1,9}$/.test(req.params.id))
    return next(Object.assign(new Error("Некоректний ідентифікатор."), { status: 400 }));
  next();
};

export function createRouter({ limitLogin = true } = {}) {
  const router = Router();
  router.param("id", (req, res, next) => idParam(req, res, next));
  router.get("/health", (_req, res) => res.json({ status: "ok" }));

  const loginLimiter = limitLogin
    ? rateLimit({
        windowMs: 60_000,
        limit: 20,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => res.status(429).json({ status: 429, message: "Забагато запитів. Спробуйте за хвилину." }),
      })
    : (_req, _res, next) => next();
  router.get("/auth/options", authController.options);
  router.get("/auth/google/start", loginLimiter, authController.googleStart);
  router.get("/auth/google/callback", authController.googleCallback);
  router.post("/auth/login", loginLimiter, authController.login);

  router.use(authenticate);
  router.post("/auth/logout", authController.logout);
  router.post("/auth/role", authController.role);
  router.get("/auth/security", authController.security);
  router.post("/auth/password", authController.password);

  router.use(requireAuth);
  router.get("/bootstrap", c.bootstrap);
  router.patch("/disciplines/:id/details", c.updateDisciplineDetails);
  router.post("/progression/:action", c.progression);
  router.post("/graduations/:action", c.graduation);
  router.post("/weight_schemes", c.saveWeightScheme);
  router.post("/lessons", c.createLesson);
  router.post("/grades", c.saveGrade);
  router.patch("/grades/:id", c.saveGrade);
  router.post("/grade_corrections", c.requestGradeCorrection);
  router.patch("/grade_corrections/:id", c.reviewGradeCorrection);
  router.patch("/attendance/:id", c.updateAttendance);
  router.post("/elective_enrollments", c.applyForElective);
  router.delete("/elective_enrollments/:id", c.cancelElectiveRequest);
  router.patch("/elective_enrollments/:id", c.reviewElectiveRequest);
  router.patch("/debts/:id", c.patchDebt);
  router.patch("/notifications/:id", c.markNotificationRead);
  router.post("/elective_limits", c.saveElectiveLimits);
  for (const resource of Object.keys(directoryKeys)) {
    router.post(`/${resource}`, c.directory);
    router.patch(`/${resource}/:id`, c.directory);
  }

  router.get("/admin/login-events", authController.loginEvents);
  router.post("/admin/users/:id/reserve-password", authController.issueReservePassword);
  router.post("/admin/users/:id/unlock", authController.unlockAccount);
  return router;
}
