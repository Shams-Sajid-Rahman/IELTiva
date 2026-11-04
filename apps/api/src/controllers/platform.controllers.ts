import {
  analyticsQuerySchema,
  announcementSchema,
  auditListQuerySchema,
  changeEmailSchema,
  changePasswordSchema,
  courseBodySchema,
  courseListQuerySchema,
  courseUpdateSchema,
  enrollmentListQuerySchema,
  enrollmentUpdateSchema,
  enrollSchema,
  idParamSchema,
  moduleBodySchema,
  moduleListQuerySchema,
  moduleUpdateSchema,
  notificationListQuerySchema,
  pageQuerySchema,
  plannerTaskSchema,
  plannerTaskUpdateSchema,
  progressSchema,
  resourceBodySchema,
  resourceUpdateSchema,
  sectionBodySchema,
  sectionUpdateSchema,
  settingUpdateSchema,
  updatePreferencesSchema,
  updateProfileSchema,
  updateRolePermissionsSchema,
  updateUserRolesSchema,
  updateUserSchema,
  updateUserStatusSchema,
  userListQuerySchema,
} from "@ieltiva/shared";
import type { Request, RequestHandler } from "express";
import type { AdminService } from "../services/admin.service.js";
import type { CourseService } from "../services/course.service.js";
import type { DashboardService } from "../services/dashboard.service.js";
import type { EnrollmentService } from "../services/enrollment.service.js";
import type { ModuleService } from "../services/module.service.js";
import type { NotificationService } from "../services/notification.service.js";
import type { PlannerService } from "../services/planner.service.js";
import type { ProfileService } from "../services/profile.service.js";
import type { RoleService } from "../services/role.service.js";
import type { UserAdminService } from "../services/user-admin.service.js";
import type { ExamServices } from "../routes/exam.routes.js";
import type { AiRuntime } from "../services/ai/runtime.js";
import type { AnalyticsServices } from "../routes/analytics.routes.js";
import type { BillingRuntime } from "../services/billing/runtime.js";
import type { ResourceFileService } from "../services/files/resource-files.service.js";
import type { OperationsService } from "../services/ops/operations.service.js";
import type { PrivacyService } from "../services/privacy/privacy.service.js";
import type { ReleaseService } from "../services/release/release.service.js";
import type { ReportService } from "../services/reports/report.service.js";
import type { InstructorReviewService } from "../services/review/instructor-review.service.js";
import type { Actor } from "../types/platform.js";
import { sendPage, sendSuccess } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";

export type PlatformServices = ExamServices & {
  aiRuntime: AiRuntime;
  billing: BillingRuntime;
  analytics: AnalyticsServices;
  operations: OperationsService;
  release: ReleaseService;
  reviews: InstructorReviewService;
  reports: ReportService;
  privacy: PrivacyService;
  resourceFiles: ResourceFileService;
  admin: AdminService;
  courses: CourseService;
  dashboard: DashboardService;
  enrollments: EnrollmentService;
  modules: ModuleService;
  notifications: NotificationService;
  planner: PlannerService;
  profile: ProfileService;
  roles: RoleService;
  users: UserAdminService;
};

function actorOf(req: Request): Actor {
  if (!req.auth) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  return { ...req.auth, ...(req.ip ? { ipAddress: req.ip } : {}) };
}

const idOf = (req: Request) => idParamSchema.parse(req.params).id;

type Handlers = Record<string, RequestHandler>;

export function createPlatformControllers(s: PlatformServices) {
  const dashboard: Handlers = {
    student: async (req, res) => sendSuccess(res, "Student dashboard", await s.dashboard.student(actorOf(req))),
    admin: async (req, res) => sendSuccess(res, "Admin dashboard", await s.dashboard.admin(actorOf(req))),
    analytics: async (req, res) => sendSuccess(res, "Analytics", await s.dashboard.analytics(analyticsQuerySchema.parse(req.query))),
  };

  const users: Handlers = {
    list: async (req, res) => sendPage(res, "Users", await s.users.list(userListQuerySchema.parse(req.query))),
    get: async (req, res) => sendSuccess(res, "User", await s.users.get(idOf(req))),
    update: async (req, res) => sendSuccess(res, "User updated", await s.users.update(actorOf(req), idOf(req), updateUserSchema.parse(req.body))),
    status: async (req, res) => {
      const { status, reason } = updateUserStatusSchema.parse(req.body);
      sendSuccess(res, "Status updated", await s.users.setStatus(actorOf(req), idOf(req), status, reason));
    },
    activity: async (req, res) => sendSuccess(res, "User activity", await s.users.activity(actorOf(req), idOf(req), pageQuerySchema.parse(req.query))),
    roles: async (req, res) => sendSuccess(res, "Roles updated", await s.roles.setUserRoles(actorOf(req), idOf(req), updateUserRolesSchema.parse(req.body).roles)),
  };

  const roles: Handlers = {
    list: async (_req, res) => sendSuccess(res, "Roles", await s.roles.list()),
    get: async (req, res) => sendSuccess(res, "Role", await s.roles.get(idOf(req))),
    permissions: async (_req, res) => sendSuccess(res, "Permissions", await s.roles.listPermissions()),
    setPermissions: async (req, res) => sendSuccess(res, "Role permissions updated", await s.roles.setRolePermissions(actorOf(req), idOf(req), updateRolePermissionsSchema.parse(req.body).permissions)),
  };

  const courses: Handlers = {
    list: async (req, res) => sendPage(res, "Courses", await s.courses.list(actorOf(req), courseListQuerySchema.parse(req.query))),
    create: async (req, res) => sendSuccess(res, "Course created", await s.courses.create(actorOf(req), courseBodySchema.parse(req.body)), 201),
    get: async (req, res) => sendSuccess(res, "Course", await s.courses.get(actorOf(req), idOf(req))),
    update: async (req, res) => sendSuccess(res, "Course updated", await s.courses.update(actorOf(req), idOf(req), courseUpdateSchema.parse(req.body))),
    remove: async (req, res) => {
      await s.courses.remove(actorOf(req), idOf(req));
      sendSuccess(res, "Course deleted", null);
    },
    publish: async (req, res) => sendSuccess(res, "Course published", await s.courses.publish(actorOf(req), idOf(req))),
    unpublish: async (req, res) => sendSuccess(res, "Course unpublished", await s.courses.unpublish(actorOf(req), idOf(req))),
    archive: async (req, res) => sendSuccess(res, "Course archived", await s.courses.archive(actorOf(req), idOf(req))),
    history: async (req, res) => sendSuccess(res, "Publication history", await s.courses.history(actorOf(req), idOf(req))),
    sections: async (req, res) => sendSuccess(res, "Sections", await s.courses.listSections(actorOf(req), idOf(req))),
    createSection: async (req, res) => sendSuccess(res, "Section created", await s.courses.createSection(actorOf(req), idOf(req), sectionBodySchema.parse(req.body)), 201),
    updateSection: async (req, res) => sendSuccess(res, "Section updated", await s.courses.updateSection(actorOf(req), idOf(req), sectionUpdateSchema.parse(req.body))),
    removeSection: async (req, res) => {
      await s.courses.archiveSection(actorOf(req), idOf(req));
      sendSuccess(res, "Section archived", null);
    },
    createResource: async (req, res) => sendSuccess(res, "Resource created", await s.courses.createResource(actorOf(req), idOf(req), resourceBodySchema.parse(req.body)), 201),
    getResource: async (req, res) => sendSuccess(res, "Resource", await s.courses.getResource(actorOf(req), idOf(req))),
    updateResource: async (req, res) => sendSuccess(res, "Resource updated", await s.courses.updateResource(actorOf(req), idOf(req), resourceUpdateSchema.parse(req.body))),
    removeResource: async (req, res) => {
      await s.courses.removeResource(actorOf(req), idOf(req));
      sendSuccess(res, "Resource removed", null);
    },
  };

  const modules: Handlers = {
    list: async (req, res) => sendPage(res, "Modules", await s.modules.list(actorOf(req), moduleListQuerySchema.parse(req.query))),
    create: async (req, res) => sendSuccess(res, "Module created", await s.modules.create(actorOf(req), moduleBodySchema.parse(req.body)), 201),
    get: async (req, res) => sendSuccess(res, "Module", await s.modules.get(actorOf(req), idOf(req))),
    update: async (req, res) => sendSuccess(res, "Module updated", await s.modules.update(actorOf(req), idOf(req), moduleUpdateSchema.parse(req.body))),
    publish: async (req, res) => sendSuccess(res, "Module published", await s.modules.publish(actorOf(req), idOf(req))),
    archive: async (req, res) => sendSuccess(res, "Module archived", await s.modules.archive(actorOf(req), idOf(req))),
  };

  const enrollments: Handlers = {
    list: async (req, res) => sendPage(res, "Enrollments", await s.enrollments.listAll(enrollmentListQuerySchema.parse(req.query))),
    create: async (req, res) => sendSuccess(res, "Enrolled", await s.enrollments.enroll(actorOf(req), enrollSchema.parse(req.body).courseId), 201),
    mine: async (req, res) => sendPage(res, "Your enrollments", await s.enrollments.listMine(actorOf(req), pageQuerySchema.parse(req.query))),
    get: async (req, res) => sendSuccess(res, "Enrollment", await s.enrollments.get(actorOf(req), idOf(req))),
    update: async (req, res) => sendSuccess(res, "Enrollment updated", await s.enrollments.setStatus(actorOf(req), idOf(req), enrollmentUpdateSchema.parse(req.body).status)),
    recordProgress: async (req, res) => sendSuccess(res, "Progress saved", await s.enrollments.recordProgress(actorOf(req), progressSchema.parse(req.body))),
    progressMine: async (req, res) => sendSuccess(res, "Your progress", await s.enrollments.progressMine(actorOf(req))),
    history: async (req, res) => sendPage(res, "Your history", await s.enrollments.history(actorOf(req), pageQuerySchema.parse(req.query))),
  };

  const planner: Handlers = {
    list: async (req, res) => sendSuccess(res, "Study tasks", await s.planner.list(actorOf(req))),
    create: async (req, res) => sendSuccess(res, "Task added", await s.planner.create(actorOf(req), plannerTaskSchema.parse(req.body)), 201),
    update: async (req, res) => sendSuccess(res, "Task updated", await s.planner.setCompleted(actorOf(req), idOf(req), plannerTaskUpdateSchema.parse(req.body).completed)),
    remove: async (req, res) => {
      await s.planner.remove(actorOf(req), idOf(req));
      sendSuccess(res, "Task removed", null);
    },
  };

  const profile: Handlers = {
    me: async (req, res) => sendSuccess(res, "Your profile", await s.profile.me(actorOf(req))),
    update: async (req, res) => sendSuccess(res, "Profile updated", await s.profile.update(actorOf(req), updateProfileSchema.parse(req.body))),
    preferences: async (req, res) => sendSuccess(res, "Preferences updated", await s.profile.updatePreferences(actorOf(req), updatePreferencesSchema.parse(req.body))),
    uploadPhoto: async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new AppError(400, "VALIDATION_ERROR", "Use a PNG, JPEG or WebP image.");
      sendSuccess(res, "Photo updated", await s.profile.uploadPhoto(actorOf(req), req.body));
    },
    removePhoto: async (req, res) => sendSuccess(res, "Photo removed", await s.profile.removePhoto(actorOf(req))),
    readPhoto: async (req, res) => {
      const { data, contentType } = await s.profile.readPhoto(actorOf(req));
      // Only this person's own photo, and browsers must not guess its type. The web app is a sibling origin.
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("Cross-Origin-Resource-Policy", "same-site");
      res.send(data);
    },
    sessions: async (req, res) => sendSuccess(res, "Your sessions", await s.profile.sessions(actorOf(req))),
    revokeSession: async (req, res) => sendSuccess(res, "Session ended", await s.profile.revokeSession(actorOf(req), idOf(req))),
    revokeOthers: async (req, res) => sendSuccess(res, "Other sessions ended", await s.profile.revokeOtherSessions(actorOf(req))),
    changePassword: async (req, res) => {
      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
      await s.profile.changePassword(actorOf(req), { currentPassword, newPassword });
      sendSuccess(res, "Password changed", null);
    },
    changeEmail: async (req, res) => {
      await s.profile.requestEmailChange(actorOf(req), changeEmailSchema.parse(req.body));
      sendSuccess(res, "If that address can be used, we'll send it a confirmation link.", null, 202);
    },
  };

  const notifications: Handlers = {
    list: async (req, res) => sendPage(res, "Notifications", await s.notifications.list(actorOf(req).userId, notificationListQuerySchema.parse(req.query))),
    unread: async (req, res) => sendSuccess(res, "Unread count", { count: await s.notifications.unreadCount(actorOf(req).userId) }),
    read: async (req, res) => {
      await s.notifications.markRead(actorOf(req).userId, idOf(req));
      sendSuccess(res, "Marked as read", null);
    },
    readAll: async (req, res) => sendSuccess(res, "All marked as read", { updated: await s.notifications.markAllRead(actorOf(req).userId) }),
    dismiss: async (req, res) => {
      await s.notifications.dismiss(actorOf(req).userId, idOf(req));
      sendSuccess(res, "Notification dismissed", null);
    },
    announcements: async (req, res) => sendPage(res, "Announcements", await s.notifications.listAnnouncements(pageQuerySchema.parse(req.query))),
    createAnnouncement: async (req, res) => sendSuccess(res, "Announcement saved", await s.notifications.createAnnouncement(actorOf(req), announcementSchema.parse(req.body)), 201),
    publishAnnouncement: async (req, res) => sendSuccess(res, "Announcement published", await s.notifications.publishAnnouncement(actorOf(req), idOf(req))),
    archiveAnnouncement: async (req, res) => sendSuccess(res, "Announcement archived", await s.notifications.archiveAnnouncement(actorOf(req), idOf(req))),
  };

  const admin: Handlers = {
    auditLogs: async (req, res) => sendPage(res, "Audit logs", await s.admin.auditLogs(auditListQuerySchema.parse(req.query))),
    settings: async (_req, res) => sendSuccess(res, "Settings", await s.admin.settings()),
    updateSetting: async (req, res) => {
      const key = String(req.params.key);
      sendSuccess(res, "Setting updated", await s.admin.updateSetting(actorOf(req), key, settingUpdateSchema.parse(req.body).value));
    },
  };

  return { dashboard, users, roles, courses, modules, enrollments, planner, profile, notifications, admin };
}
