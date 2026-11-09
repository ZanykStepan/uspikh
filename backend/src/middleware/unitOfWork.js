import { UnitOfWork } from "../repositories/unitOfWork.js";
import { createContext } from "../services/domainContext.js";
import { fail } from "../utils/httpError.js";

const accessible = (account) => account && (account.status === "active" || (account.status === "graduated" && account.role === "student"));

function resolveActor(db, req, { allowDemoHeader }) {
  const auth = req.auth;
  const userId = auth?.userId ?? (allowDemoHeader ? Number(req.headers["x-demo-user"] || 1) : null);
  const account = db.users.find((user) => user.user_id === userId);
  const actor = account && (!auth || account.roles.includes(auth.role)) && { ...account, role: auth?.role || account.role };
  if (!actor || !accessible(actor)) fail(401, "Профіль недоступний.");
  return actor;
}

async function reconcileIfNeeded(deps) {
  const today = deps.today();
  if (deps.state.reconciledOn === today) return;
  const uow = await UnitOfWork.begin(deps.pool, { write: true });
  try {
    createContext(uow.db, { currentDate: deps.today, actor: null }).reconcileDebts();
    await uow.commit();
    deps.state.reconciledOn = today;
  } catch (error) {
    await uow.rollback().catch(() => {});
    throw error;
  }
}

export function transactional(handler, { write = true } = {}) {
  return async (req, res) => {
    const deps = req.app.locals.deps;
    if (!write) await reconcileIfNeeded(deps);
    const uow = await UnitOfWork.begin(deps.pool, { write });
    try {
      const actor = resolveActor(uow.db, req, deps);
      const ctx = createContext(uow.db, { currentDate: deps.today, actor });
      if (actor.role === "student" && actor.student_status === "graduated" && req.method !== "GET")
        fail(403, "Архівний профіль доступний лише для перегляду.");
      if (write && deps.state.reconciledOn !== deps.today()) ctx.reconcileDebts();
      const resource = req.params.resource ?? req.path.split("/")[1];
      const result = await handler({
        ...ctx,
        db: uow.db,
        client: uow.client,
        req,
        body: req.body ?? {},
        recordId: Number(req.params.id),
        parts: ["", "api", resource, req.params.action ?? req.params.id],
        resource,
      });
      if (write && result.status < 400) ctx.reconcileDebts();
      await uow.commit();
      if (write) deps.state.reconciledOn = deps.today();
      res.status(result.status).json(result.data);
    } catch (error) {
      await uow.rollback().catch(() => {});
      throw error;
    }
  };
}
