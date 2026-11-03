"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/features/auth/auth-provider";
import { AuthNav } from "@/features/auth/components/auth-nav";
import { cn } from "@/lib/utils";
import { Container } from "./container";
import { ThemeToggle } from "./theme-toggle";

const links = [
  { href: "/#how", key: "how" },
  { href: "/#modules", key: "modules" },
  { href: "/#pricing", key: "pricing" },
  { href: "/#faq", key: "faq" },
] as const;

export function SiteHeader() {
  const t = useTranslations("nav");
  const common = useTranslations("common");
  const auth = useTranslations("auth");
  const { status } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const linkClass = "text-muted-foreground hover:text-foreground hover:bg-muted rounded-md px-3 py-2 text-sm font-medium transition-colors";

  return (
    <header className={cn("bg-background/90 sticky top-0 z-40 border-b backdrop-blur transition-shadow duration-200", scrolled ? "shadow-soft" : "border-transparent")}>
      <Container className="flex h-16 items-center justify-between gap-2">
        <Link href="/" aria-label={common("brandHome")} className="rounded-md">
          <Logo />
        </Link>
        <nav aria-label={t("main")} className="hidden items-center gap-1 md:flex">
          {links.map(({ href, key }) => (
            <Link key={href} href={href} className={linkClass}>
              {t(key)}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <AuthNav />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label={t("menu")}>
                <Menu aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[min(20rem,85vw)]">
              <SheetHeader>
                <SheetTitle>{t("menuTitle")}</SheetTitle>
                <SheetDescription className="sr-only">{t("main")}</SheetDescription>
              </SheetHeader>
              <nav aria-label={t("main")} className="flex flex-col gap-1 px-4">
                {links.map(({ href, key }) => (
                  <Link key={href} href={href} className="hover:bg-muted rounded-lg px-3 py-3 text-base font-medium transition-colors" onClick={() => setOpen(false)}>
                    {t(key)}
                  </Link>
                ))}
              </nav>
              {status !== "authenticated" && (
                <div className="mt-auto grid gap-2 p-4">
                  <Button asChild size="lg">
                    <Link href="/register" onClick={() => setOpen(false)}>{auth("getStarted")}</Link>
                  </Button>
                </div>
              )}
            </SheetContent>
          </Sheet>
        </div>
      </Container>
    </header>
  );
}
