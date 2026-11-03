"use client";

import { BarChart3, Bot, BookOpen, CalendarCheck, CreditCard, GraduationCap, History, LayoutDashboard, Bell, Package, Settings, Target, User } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { RequireAuth } from "@/features/auth/route-guards";
import { DashboardShell, type NavItem } from "./shell";

export function StudentLayout({ children }: { children: ReactNode }) {
  const t = useTranslations("app");
  const items: NavItem[] = [
    { href: "/dashboard", label: t("overview"), icon: LayoutDashboard },
    { href: "/learning", label: t("my_learning"), icon: GraduationCap },
    { href: "/courses", label: t("browse_courses"), icon: BookOpen },
    { href: "/practice", label: t("ielts_practice"), icon: Target },
    { href: "/analytics", label: t("my_progress"), icon: BarChart3 },
    { href: "/tutor", label: t("ai_tutor"), icon: Bot },
    { href: "/planner", label: t("study_planner"), icon: CalendarCheck },
    { href: "/packages", label: t("packages"), icon: Package },
    { href: "/billing", label: t("billing"), icon: CreditCard },
    { href: "/history", label: t("learning_history"), icon: History },
    { href: "/notifications", label: t("notifications"), icon: Bell },
    { href: "/profile", label: t("my_profile"), icon: User },
    { href: "/settings", label: t("settings"), icon: Settings },
  ];
  return (
    <RequireAuth>
      <DashboardShell items={items} quickItems={items.slice(0, 4)} rootHref="/dashboard" rootLabel={t("dashboard")} navLabel={t("student_navigation")}>
        {children}
      </DashboardShell>
    </RequireAuth>
  );
}
