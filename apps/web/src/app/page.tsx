import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Container } from "@/components/layout/container";
import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const t = await getTranslations("home");

  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-x-0 -top-40 h-[32rem] bg-[radial-gradient(ellipse_at_center,var(--hero-glow),transparent_68%)]"
      />
      <Container className="relative py-20 sm:py-28 lg:py-36">
        <Reveal className="max-w-3xl">
          <p className="text-brand-teal text-sm font-semibold tracking-wide uppercase">{t("eyebrow")}</p>
          <h1 className="mt-4 text-4xl leading-[1.08] font-medium sm:text-5xl lg:text-6xl">{t("title")}</h1>
          <p className="text-muted-foreground mt-6 max-w-2xl text-lg leading-relaxed">{t("body")}</p>
          <Button asChild size="lg" className="mt-9">
            <Link href="/design-system">
              {t("cta")}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </Reveal>
      </Container>
    </div>
  );
}
