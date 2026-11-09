import { transactional } from "../middleware/unitOfWork.js";
import { buildBootstrap } from "../services/bootstrapService.js";
import * as journal from "../services/journalService.js";
import * as electives from "../services/electiveService.js";
import { updateDebt } from "../services/debtService.js";
import { promoteGroups, graduateGroups } from "../services/progressionService.js";
import { saveDirectoryRecord, directoryKeys } from "../services/directoryService.js";
import { fail } from "../utils/httpError.js";

export const bootstrap = transactional(buildBootstrap, { write: false });
export const updateDisciplineDetails = transactional(journal.updateDisciplineDetails);
export const saveWeightScheme = transactional(journal.saveWeightScheme);
export const createLesson = transactional(journal.createLesson);
export const saveGrade = transactional(journal.saveGrade);
export const requestGradeCorrection = transactional(journal.requestGradeCorrection);
export const reviewGradeCorrection = transactional(journal.reviewGradeCorrection);
export const updateAttendance = transactional(journal.updateAttendance);
export const markNotificationRead = transactional(journal.markNotificationRead);
export const applyForElective = transactional(electives.applyForElective);
export const cancelElectiveRequest = transactional(electives.cancelElectiveRequest);
export const reviewElectiveRequest = transactional(electives.reviewElectiveRequest);
export const saveElectiveLimits = transactional(electives.saveElectiveLimits);
export const patchDebt = transactional(updateDebt);

const stage = (service) =>
  transactional((c) => {
    if (!["preview", "apply"].includes(c.req.params.action)) fail(404, "Маршрут не знайдено.");
    return service(c);
  });
export const progression = stage(promoteGroups);
export const graduation = stage(graduateGroups);

export const directory = transactional((c) => {
  if (!directoryKeys[c.resource]) fail(404, "Маршрут не знайдено.");
  return saveDirectoryRecord(c);
});
