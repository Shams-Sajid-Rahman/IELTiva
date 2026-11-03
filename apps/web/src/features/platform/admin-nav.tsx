"use client";

import { Bell, BookOpen, ClipboardList, CreditCard, FileCheck, GraduationCap, Layers, LayoutDashboard, ScrollText, Settings, ShieldCheck, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { STAFF_ROLES } from "@/features/auth/navigation";
import { RequireAuth } from "@/features/auth/route-guards";
import { DashboardShell, type NavItem } from "./shell";

function Shell({ children }: { children: ReactNode }) {
  const t = useTranslations("app");
  const { hasPermission } = useAuth();
  // Only a convenience. The API checks each permission again on every request.
  const entries: (NavItem & { permission?: string; anyOf?: string[] })[] = [
    { href: "/admin", label: t("overview"), icon: LayoutDashboard, permission: "dashboard.admin" },
    { href: "/admin/users", label: t("users"), icon: Users, permission: "users.read" },
    { href: "/admin/roles", label: t("roles_and_permissions"), icon: ShieldCheck, permission: "roles.read" },
    { href: "/admin/courses", label: t("courses"), icon: BookOpen, anyOf: ["courses.manage", "courses.manage_all"] },
    { href: "/admin/modules", label: t("learning_modules"), icon: Layers, permission: "modules.manage" },
    { href: "/admin/enrollments", label: t("enrollments"), icon: GraduationCap, permission: "enrollments.read" },
    { href: "/admin/notifications", label: t("announcements"), icon: Bell, permission: "notifications.manage" },
    { href: "/admin/audit-logs", label: t("audit_logs"), icon: ScrollText, permission: "audit.read" },
    { href: "/admin/settings", label: t("platform_settings"), icon: Settings, permission: "settings.read" },
    { href: "/admin/assessments", label: t("ielts_assessments"), icon: FileCheck, comingLater: true },
    { href: "/admin/payments", label: t("payments"), icon: CreditCard, comingLater: true },
    { href: "/admin/reports", label: t("reports"), icon: ClipboardList, comingLater: true },
  ];
  const items = entries.filter((entry) => entry.comingLater || (entry.permission ? hasPermission(entry.permission) : entry.anyOf?.some(hasPermission)));
  return (
    <DashboardShell items={items} rootHref="/admin" rootLabel={t("administration")} navLabel={t("administration_navigation")}>
      {children}
    </DashboardShell>
  );
}

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth roles={STAFF_ROLES}>
      <Shell>{children}</Shell>
    </RequireAuth>
  );
}
