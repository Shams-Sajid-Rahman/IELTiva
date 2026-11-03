import { ArrowRight, Check, FileCheck2, Landmark, Lock, ScanSearch, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Container } from "@/components/layout/container";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BandCalculator } from "@/features/marketing/band-calculator";
import { HowItWorks } from "@/features/marketing/how-it-works";
import { ModuleShowcase } from "@/features/marketing/module-showcase";
import { ProductDemos } from "@/features/marketing/product-demos";
import { testimonials } from "@/features/marketing/testimonials";

function SectionIntro({ id, eyebrow, title, body }: { id: string; eyebrow: string; title: string; body?: ReactNode }) {
  return (
    <Reveal className="mb-10 max-w-3xl sm:mb-14">
      <p className="text-primary text-sm font-semibold">{eyebrow}</p>
      <h2 id={id} className="mt-2 text-3xl font-semibold sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">{title}</h2>
      {body && <p className="text-muted-foreground mt-4 text-lg leading-relaxed">{body}</p>}
    </Reveal>
  );
}

export default async function HomePage() {
  const t = await getTranslations("home");
  const pricing = [
    { key: "pack", includes: ["1", "2"] },
    { key: "pass", includes: ["1", "2"] },
    { key: "bundle", includes: ["1", "2"] },
  ];
  const trust = [
    { key: "independent", icon: Landmark },
    { key: "validated", icon: ScanSearch },
    { key: "private", icon: Lock },
    { key: "original", icon: FileCheck2 },
    { key: "prepaid", icon: Wallet },
    { key: "honest", icon: ShieldCheck },
  ];
  const faqs = ["q1", "q2", "q3", "q4", "q5"];

  return (
    <>
      <section aria-labelledby="hero-title" className="bg-brand-surface relative overflow-hidden">
        <div aria-hidden className="brand-grid absolute inset-0" />
        <div aria-hidden className="bg-brand-blue/30 absolute -top-40 right-0 size-[34rem] rounded-full blur-3xl" />
        <Container className="relative grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:py-28 2xl:py-32">
          <div className="animate-in fade-in-0 slide-in-from-bottom-3 duration-700">
            <p className="text-brand-sky font-semibold">{t("eyebrow")}</p>
            <h1 id="hero-title" className="mt-4 text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-6xl lg:text-[4.25rem]">{t("title")}</h1>
            <p className="text-on-brand-muted mt-6 max-w-xl text-lg leading-relaxed">{t("body")}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" variant="onBrand">
                <Link href="/register">{t("cta")} <ArrowRight aria-hidden /></Link>
              </Button>
              <Button asChild size="lg" variant="onBrandOutline">
                <Link href="#how">{t("ctaSecondary")}</Link>
              </Button>
            </div>
            <ul className="text-on-brand-muted mt-8 flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
              {["point1", "point2", "point3"].map((key) => (
                <li key={key} className="flex items-center gap-2"><Check className="text-brand-sky size-4 shrink-0" aria-hidden /> {t(key)}</li>
              ))}
            </ul>
          </div>
          <div className="animate-in fade-in-0 slide-in-from-bottom-6 min-w-0 delay-150 duration-700 fill-mode-both">
            <BandCalculator />
          </div>
        </Container>
      </section>

      <section id="how" aria-labelledby="how-title" className="scroll-mt-20 py-16 sm:py-24">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
          <SectionIntro id="how-title" eyebrow={t("how.eyebrow")} title={t("how.title")} />
          <HowItWorks />
        </Container>
      </section>

      <section aria-labelledby="demos-title" className="bg-card border-y py-16 sm:py-24">
        <Container>
          <SectionIntro id="demos-title" eyebrow={t("demos.eyebrow")} title={t("demos.title")} body={t("demos.intro")} />
          <Reveal><ProductDemos /></Reveal>
        </Container>
      </section>

      <section id="modules" aria-labelledby="modules-title" className="scroll-mt-20 py-16 sm:py-24">
        <Container>
          <SectionIntro id="modules-title" eyebrow={t("modules.eyebrow")} title={t("modules.title")} body={t("modules.intro")} />
          <Reveal><ModuleShowcase /></Reveal>
        </Container>
      </section>

      <section id="pricing" aria-labelledby="pricing-title" className="bg-card scroll-mt-20 border-y py-16 sm:py-24">
        <Container>
          <SectionIntro id="pricing-title" eyebrow={t("pricing.eyebrow")} title={t("pricing.title")} body={t("pricing.intro")} />
          <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
            <Reveal className="bg-brand-surface relative overflow-hidden rounded-2xl p-6 sm:p-8">
              <div aria-hidden className="brand-grid absolute inset-0" />
              <div className="relative flex h-full flex-col">
                <Badge className="bg-brand-green w-fit text-brand-navy">{t("pricing.free.badge")}</Badge>
                <h3 className="mt-4 text-2xl font-semibold">{t("pricing.free.title")}</h3>
                <p className="text-on-brand-muted mt-2 leading-relaxed">{t("pricing.free.body")}</p>
                <ul className="mt-6 space-y-3 text-sm">
                  {["item1", "item2", "item3"].map((key) => (
                    <li key={key} className="flex gap-2.5"><Check className="text-brand-sky mt-0.5 size-4 shrink-0" aria-hidden /> {t(`pricing.free.${key}`)}</li>
                  ))}
                </ul>
                <Button asChild variant="onBrand" size="lg" className="mt-8 lg:mt-auto">
                  <Link href="/register">{t("cta")}</Link>
                </Button>
              </div>
            </Reveal>
            <Stagger className="grid gap-4">
              {pricing.map(({ key, includes }) => (
                <StaggerItem key={key} className="lift bg-background grid gap-4 rounded-2xl border p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
                  <div className="min-w-0">
                    <h3 className="text-xl font-semibold">{t(`pricing.${key}.title`)}</h3>
                    <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{t(`pricing.${key}.body`)}</p>
                    <ul className="mt-3 flex flex-col gap-x-5 gap-y-1.5 text-sm sm:flex-row sm:flex-wrap">
                      {includes.map((item) => (
                        <li key={item} className="flex gap-2"><Check className="text-success mt-0.5 size-4 shrink-0" aria-hidden /> {t(`pricing.${key}.include${item}`)}</li>
                      ))}
                    </ul>
                  </div>
                  <p className="text-muted-foreground text-sm font-medium sm:max-w-32 sm:text-right">{t("pricing.priceLater")}</p>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
          <p className="text-muted-foreground mt-6 text-sm">{t("pricing.note")}</p>
        </Container>
      </section>

      <section aria-labelledby="trust-title" className="py-16 sm:py-24">
        <Container>
          <SectionIntro id="trust-title" eyebrow={t("trust.eyebrow")} title={t("trust.title")} />
          <Stagger className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {trust.map(({ key, icon: Icon }) => (
              <StaggerItem key={key} className="border-t pt-5">
                <Icon className="text-primary size-6" aria-hidden />
                <h3 className="mt-3 text-lg font-semibold">{t(`trust.${key}.title`)}</h3>
                <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{t(`trust.${key}.body`)}</p>
              </StaggerItem>
            ))}
          </Stagger>
          {testimonials.length > 0 && (
            <div className="mt-14 grid gap-6 md:grid-cols-3">
              {testimonials.map((item) => (
                <figure key={item.name} className="bg-card shadow-soft rounded-2xl border p-6">
                  <blockquote className="leading-relaxed">{item.quote}</blockquote>
                  <figcaption className="text-muted-foreground mt-4 text-sm"><span className="text-foreground font-medium">{item.name}</span>, {item.context}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </Container>
      </section>

      <section id="faq" aria-labelledby="faq-title" className="bg-card scroll-mt-20 border-y py-16 sm:py-24">
        <Container className="grid gap-8 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
          <Reveal><h2 id="faq-title" className="text-3xl font-semibold sm:text-4xl">{t("faq.title")}</h2></Reveal>
          <Accordion type="single" collapsible>
            {faqs.map((key) => (
              <AccordionItem key={key} value={key}>
                <AccordionTrigger className="text-left text-base">{t(`faq.${key}.q`)}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-relaxed">{t(`faq.${key}.a`)}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Container>
      </section>

      <section aria-labelledby="cta-title" className="py-16 sm:py-24">
        <Container>
          <Reveal className="bg-brand-surface relative overflow-hidden rounded-3xl px-6 py-12 text-center sm:px-12 sm:py-20">
            <div aria-hidden className="brand-grid absolute inset-0" />
            <div className="relative mx-auto max-w-2xl">
              <h2 id="cta-title" className="text-3xl font-semibold sm:text-5xl">{t("final.title")}</h2>
              <p className="text-on-brand-muted mt-4 text-lg leading-relaxed">{t("final.body")}</p>
              <Button asChild size="lg" variant="onBrand" className="mt-8 w-full sm:w-auto">
                <Link href="/register">{t("cta")} <ArrowRight aria-hidden /></Link>
              </Button>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
