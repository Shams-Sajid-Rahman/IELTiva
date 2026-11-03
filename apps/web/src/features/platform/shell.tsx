"use client";

import type { LucideIcon } from "lucide-react";
import { Bell, ChevronRight, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck, User } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/features/auth/auth-provider";
import { STAFF_ROLES } from "@/features/auth/navigation";
import { cn } from "@/lib/utils";
import { useApiQuery } from "./hooks";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown but not usable, for modules that arrive in a later phase. */
  comingLater?: boolean;
};

const COLLAPSE_KEY = "ieltiva_sidebar_collapsed";

function isActive(pathname: string, href: string, rootHref: string) {
  return href === rootHref ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ items, rootHref, collapsed, onNavigate, label, indicatorId }: { items: NavItem[]; rootHref: string; collapsed?: boolean; onNavigate?: () => void; label: string; indicatorId: string }) {
  const t = useTranslations("app");
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="space-y-1">
        {items.map(({ href, label: text, icon: Icon, comingLater }) => {
          const active = isActive(pathname, href, rootHref);
          if (comingLater) {
            return (
              <li key={href} className={cn("text-muted-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm", collapsed && "justify-center px-0")} title={text}>
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>{text}</span>
                {!collapsed && <Badge variant="outline">{t("later")}</Badge>}
              </li>
            );
          }
          return (
            <li key={href}>
              <Link
                href={href}
                title={collapsed ? text : undefined}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors pointer-coarse:py-3",
                  active ? "text-primary-foreground" : "text-foreground hover:bg-muted",
                  collapsed && "justify-center px-0",
                )}
              >
                {active && <motion.span aria-hidden layoutId={indicatorId} transition={{ type: "spring", stiffness: 420, damping: 36 }} className="bg-primary absolute inset-0 rounded-lg" />}
                <Icon className="relative size-4 shrink-0" aria-hidden />
                <span className={collapsed ? "sr-only" : "relative truncate"}>{text}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Breadcrumbs({ items, rootHref, rootLabel }: { items: NavItem[]; rootHref: string; rootLabel: string }) {
  const t = useTranslations("app");
  const pathname = usePathname();
  const current = items.find((item) => item.href !== rootHref && isActive(pathname, item.href, rootHref));
  const detail = current && pathname !== current.href;
  return (
    <nav aria-label={t("breadcrumb")} className="hidden min-w-0 md:block">
      <ol className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <li>
          <Link href={rootHref} className="hover:text-foreground underline-offset-4 hover:underline">
            {rootLabel}
          </Link>
        </li>
        {current && (
          <li className="flex items-center gap-1.5">
            <ChevronRight className="size-3.5" aria-hidden />
            {detail ? (
              <Link href={current.href} className="hover:text-foreground underline-offset-4 hover:underline">
                {current.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-foreground font-medium">
                {current.label}
              </span>
            )}
          </li>
        )}
        {detail && (
          <li className="flex items-center gap-1.5">
            <ChevronRight className="size-3.5" aria-hidden />
            <span aria-current="page" className="text-foreground font-medium">
              {t("details")}
            </span>
          </li>
        )}
      </ol>
    </nav>
  );
}

function NotificationBell() {
  const t = useTranslations("app");
  const unread = useApiQuery<{ count: number }>("/notifications/unread-count", { refetchInterval: 60_000 });
  const count = unread.data?.count ?? 0;
  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <Link href="/notifications">
        <Bell aria-hidden />
        <span className="sr-only">{t("notifications_count_unread", { count })}</span>
        {count > 0 && (
          <span aria-hidden className="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </Button>
  );
}

function UserMenu() {
  const t = useTranslations("app");
  const { user, logout, hasRole } = useAuth();
  const router = useRouter();
  if (!user) return null;
  const staff = hasRole(...STAFF_ROLES);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full">
          <span className="sr-only">{t("account_menu")}</span>
          <Avatar className="size-8" aria-hidden>
            <AvatarFallback>{`${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase() || "U"}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate font-medium">{`${user.firstName} ${user.lastName}`}</span>
          <span className="text-muted-foreground block truncate text-xs">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <LayoutDashboard aria-hidden />
            {t("student_dashboard")}
          </Link>
        </DropdownMenuItem>
        {staff && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <ShieldCheck aria-hidden />
              {t("administration")}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <User aria-hidden />
            {t("my_profile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden />
            {t("settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void logout()
              .catch(() => {})
              .finally(() => router.replace("/login"));
          }}
        >
          <LogOut aria-hidden />
          {t("sign_out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Thumb-reach navigation for phones and tablets. The drawer still holds the full menu. */
function BottomNav({ items, rootHref, label }: { items: NavItem[]; rootHref: string; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="bg-card fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map(({ href, label: text, icon: Icon }) => {
          const active = isActive(pathname, href, rootHref);
          return (
            <li key={href}>
              <Link href={href} aria-current={active ? "page" : undefined} className={cn("flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[0.6875rem] font-medium transition-colors", active ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                <Icon className="size-5" aria-hidden />
                <span className="text-center leading-tight">{text}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function DashboardShell({ items, quickItems, rootHref, rootLabel, navLabel, children }: { items: NavItem[]; quickItems?: NavItem[]; rootHref: string; rootLabel: string; navLabel: string; children: ReactNode }) {
  const t = useTranslations("app");
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      // Read after mounting, because the server can't know this preference.
      const stored = localStorage.getItem(COLLAPSE_KEY) === "1";
      queueMicrotask(() => setCollapsed(stored));
    } catch {
      // Without storage, the sidebar simply starts expanded.
    }
  }, []);

  function toggle() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, value ? "0" : "1");
      } catch {
        // The choice just isn't remembered.
      }
      return !value;
    });
  }

  return (
    <div className="flex min-h-dvh">
      <aside aria-label={navLabel} className={cn("bg-card sticky top-0 hidden h-dvh shrink-0 flex-col border-r transition-[width] duration-200 lg:flex", collapsed ? "w-[4.5rem]" : "w-64")}>
        <div className={cn("flex h-16 items-center border-b px-4", collapsed && "justify-center px-0")}>
          <Link href={rootHref} aria-label={`IELTiva, ${rootLabel}`} className="rounded-md">
            <Logo showWordmark={!collapsed} />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavList items={items} rootHref={rootHref} collapsed={collapsed} label={navLabel} indicatorId="sidebar-active" />
        </div>
        <div className="border-t p-3">
          <Button variant="ghost" className={cn("w-full", collapsed ? "justify-center px-0" : "justify-start")} aria-expanded={!collapsed} onClick={toggle}>
            {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
            <span className={collapsed ? "sr-only" : undefined}>{collapsed ? t("expand_sidebar") : t("collapse_sidebar")}</span>
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/90 sticky top-0 z-30 flex h-16 items-center gap-2 border-b px-4 backdrop-blur sm:px-6">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t("open_navigation")}>
                <Menu aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 overflow-y-auto">
              <SheetHeader>
                <SheetTitle>
                  <Logo />
                </SheetTitle>
                <SheetDescription className="sr-only">{navLabel}</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">
                <NavList items={items} rootHref={rootHref} onNavigate={() => setDrawerOpen(false)} label={navLabel} indicatorId="drawer-active" />
              </div>
            </SheetContent>
          </Sheet>
          <Breadcrumbs items={items} rootHref={rootHref} rootLabel={rootLabel} />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main id="main" tabIndex={-1} className={cn("mx-auto w-full max-w-7xl min-w-0 flex-1 p-4 outline-none sm:p-6 lg:p-8 2xl:max-w-[96rem]", quickItems && "pb-28 lg:pb-8")}>
          {children}
        </main>
        {quickItems && <BottomNav items={quickItems} rootHref={rootHref} label={t("quick_navigation")} />}
      </div>
    </div>
  );
}
