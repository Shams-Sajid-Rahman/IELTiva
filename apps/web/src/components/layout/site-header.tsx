"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Logo } from "@/components/brand/logo";
import { AuthNav } from "@/features/auth/components/auth-nav";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Container } from "./container";
import { ThemeToggle } from "./theme-toggle";

const links = [
  { href: "/", key: "home" },
  { href: "/design-system", key: "designSystem" },
] as const;

export function SiteHeader() {
  const t = useTranslations("nav");
  const common = useTranslations("common");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const linkClass = (href: string) =>
    cn(
      "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted",
      pathname === href ? "text-foreground" : "text-muted-foreground",
    );

  return (
    <header className="bg-background/85 sticky top-0 z-40 border-b backdrop-blur">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href="/" aria-label={common("brandHome")} className="rounded-md">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <nav aria-label={t("main")} className="hidden items-center gap-1 md:flex">
            {links.map(({ href, key }) => (
              <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={linkClass(href)}>
                {t(key)}
              </Link>
            ))}
          </nav>
          <ThemeToggle />
          <AuthNav />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label={t("menu")}>
                <Menu aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle>{t("menuTitle")}</SheetTitle>
                <SheetDescription className="sr-only">{t("main")}</SheetDescription>
              </SheetHeader>
              <nav aria-label={t("main")} className="flex flex-col gap-1 px-4">
                {links.map(({ href, key }) => (
                  <Link
                    key={href}
                    href={href}
                    aria-current={pathname === href ? "page" : undefined}
                    className={linkClass(href)}
                    onClick={() => setOpen(false)}
                  >
                    {t(key)}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </Container>
    </header>
  );
}
