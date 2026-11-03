import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { Container } from "./container";

export async function SiteFooter() {
  const common = await getTranslations("common");
  const nav = await getTranslations("nav");
  const footer = await getTranslations("footer");
  const auth = await getTranslations("auth");

  const columns = [
    {
      title: footer("product"),
      links: [
        { href: "/#how", label: nav("how") },
        { href: "/#modules", label: nav("modules") },
        { href: "/#pricing", label: nav("pricing") },
        { href: "/#faq", label: nav("faq") },
      ],
    },
    {
      title: footer("account"),
      links: [
        { href: "/register", label: auth("getStarted") },
        { href: "/login", label: auth("signIn") },
        { href: "/forgot-password", label: footer("forgotPassword") },
      ],
    },
  ];

  return (
    <footer className="bg-card border-t">
      <Container className="grid gap-10 py-12 md:grid-cols-[2fr_1fr_1fr]">
        <div className="max-w-md">
          <Logo />
          <p className="font-display mt-4 text-lg font-medium">{footer("tagline")}</p>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{common("disclaimer")}</p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="font-sans text-sm font-semibold tracking-normal">{column.title}</h2>
            <ul className="mt-3 space-y-1">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-muted-foreground hover:text-foreground inline-block py-1 text-sm underline-offset-4 transition-colors hover:underline pointer-coarse:py-2">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <Container className="border-t py-5">
        <p className="text-muted-foreground text-sm">{footer("copyright", { year: new Date().getFullYear() })}</p>
      </Container>
    </footer>
  );
}
