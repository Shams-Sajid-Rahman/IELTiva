import express, { Router, type RequestHandler } from "express";
import { createPlatformControllers, type PlatformServices } from "../controllers/platform.controllers.js";
import { requireAnyPermission, requirePermission } from "../middleware/authenticate.js";
import { sensitiveActionLimit } from "../middleware/rate-limit.js";
import { createAiRouter } from "./ai.routes.js";
import { createAnalyticsRouter } from "./analytics.routes.js";
import { createBillingRouter } from "./billing.routes.js";
import { createExamRouter } from "./exam.routes.js";
import { createOpsRouter } from "./ops.routes.js";
import { createPrivacyRouter } from "./privacy.routes.js";

/** Every route needs a signed-in user. Permissions are enforced here, and ownership inside each service. */
export function createPlatformRouter(services: PlatformServices, authenticateUser: RequestHandler) {
  const c = createPlatformControllers(services);
  const r = Router();
  const can = requirePermission;
  const author = requireAnyPermission("courses.manage", "courses.manage_all");

  r.use(authenticateUser);
  r.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  r.use(createExamRouter(services));
  r.use(createAiRouter(services.aiRuntime));
  r.use(createBillingRouter(services.billing));
  r.use(createAnalyticsRouter(services.analytics));
  r.use(createOpsRouter(services));
  r.use(createPrivacyRouter(services));

  r.get("/dashboard/student", c.dashboard.student!);
  r.get("/dashboard/admin", can("dashboard.admin"), c.dashboard.admin!);
  r.get("/dashboard/analytics", can("dashboard.admin"), c.dashboard.analytics!);

  r.get("/users", can("users.read"), c.users.list!);
  r.get("/users/:id", can("users.read"), c.users.get!);
  r.patch("/users/:id", can("users.manage"), c.users.update!);
  r.patch("/users/:id/status", can("users.manage"), c.users.status!);
  r.get("/users/:id/activity", can("users.read"), c.users.activity!);
  r.patch("/users/:id/roles", can("roles.assign"), c.users.roles!);

  r.get("/roles", can("roles.read"), c.roles.list!);
  r.get("/roles/:id", can("roles.read"), c.roles.get!);
  r.patch("/roles/:id/permissions", can("roles.manage"), c.roles.setPermissions!);
  r.get("/permissions", can("roles.read"), c.roles.permissions!);

  r.get("/courses", c.courses.list!);
  r.post("/courses", author, c.courses.create!);
  r.get("/courses/:id", c.courses.get!);
  r.patch("/courses/:id", author, c.courses.update!);
  r.delete("/courses/:id", author, c.courses.remove!);
  r.post("/courses/:id/publish", can("courses.publish"), c.courses.publish!);
  r.post("/courses/:id/unpublish", can("courses.publish"), c.courses.unpublish!);
  r.post("/courses/:id/archive", can("courses.publish"), c.courses.archive!);
  r.get("/courses/:id/history", author, c.courses.history!);
  r.get("/courses/:id/sections", c.courses.sections!);
  r.post("/courses/:id/sections", author, c.courses.createSection!);
  r.patch("/sections/:id", author, c.courses.updateSection!);
  r.delete("/sections/:id", author, c.courses.removeSection!);
  r.post("/sections/:id/resources", author, c.courses.createResource!);
  r.get("/resources/:id", c.courses.getResource!);
  r.patch("/resources/:id", author, c.courses.updateResource!);
  r.delete("/resources/:id", author, c.courses.removeResource!);

  r.get("/modules", c.modules.list!);
  r.post("/modules", can("modules.manage"), c.modules.create!);
  r.get("/modules/:id", c.modules.get!);
  r.patch("/modules/:id", can("modules.manage"), c.modules.update!);
  r.post("/modules/:id/publish", can("modules.manage"), c.modules.publish!);
  r.post("/modules/:id/archive", can("modules.manage"), c.modules.archive!);

  r.get("/enrollments", can("enrollments.read"), c.enrollments.list!);
  r.post("/enrollments", c.enrollments.create!);
  r.get("/enrollments/me", c.enrollments.mine!);
  r.get("/enrollments/:id", c.enrollments.get!);
  r.patch("/enrollments/:id", c.enrollments.update!);
  r.post("/progress", c.enrollments.recordProgress!);
  r.get("/progress/me", c.enrollments.progressMine!);
  r.get("/history/me", c.enrollments.history!);

  r.get("/planner/tasks", c.planner.list!);
  r.post("/planner/tasks", c.planner.create!);
  r.patch("/planner/tasks/:id", c.planner.update!);
  r.delete("/planner/tasks/:id", c.planner.remove!);

  r.get("/profile/me", c.profile.me!);
  r.patch("/profile/me", c.profile.update!);
  r.patch("/profile/preferences", c.profile.preferences!);
  r.put("/profile/photo", express.raw({ type: () => true, limit: "2mb" }), c.profile.uploadPhoto!);
  r.get("/profile/photo", c.profile.readPhoto!);
  r.delete("/profile/photo", c.profile.removePhoto!);
  r.post("/profile/password", sensitiveActionLimit("password"), c.profile.changePassword!);
  r.post("/profile/email", sensitiveActionLimit("email"), c.profile.changeEmail!);
  r.get("/profile/sessions", c.profile.sessions!);
  r.delete("/profile/sessions", c.profile.revokeOthers!);
  r.delete("/profile/sessions/:id", c.profile.revokeSession!);

  r.get("/notifications", c.notifications.list!);
  r.get("/notifications/unread-count", c.notifications.unread!);
  r.patch("/notifications/read-all", c.notifications.readAll!);
  r.patch("/notifications/:id/read", c.notifications.read!);
  r.delete("/notifications/:id", c.notifications.dismiss!);

  r.get("/admin/notifications", can("notifications.manage"), c.notifications.announcements!);
  r.post("/admin/notifications", can("notifications.manage"), c.notifications.createAnnouncement!);
  r.post("/admin/notifications/:id/publish", can("notifications.manage"), c.notifications.publishAnnouncement!);
  r.post("/admin/notifications/:id/archive", can("notifications.manage"), c.notifications.archiveAnnouncement!);
  r.get("/admin/audit-logs", can("audit.read"), c.admin.auditLogs!);
  r.get("/admin/settings", can("settings.read"), c.admin.settings!);
  r.patch("/admin/settings/:key", can("settings.manage"), c.admin.updateSetting!);

  return r;
}
