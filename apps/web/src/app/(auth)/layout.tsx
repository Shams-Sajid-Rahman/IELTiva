import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Reveal } from "@/components/motion/reveal";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // Reset and verification links carry tokens, so they mustn't be sent to other sites as referrers.
  referrer: "no-referrer",
};

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("auth");
  const points = [t("panelPoint1"), t("panelPoint2"), t("panelPoint3")];

  return (
    <div className="grid lg:grid-cols-[1fr_minmax(0,28rem)] xl:grid-cols-[1fr_32rem]">
      <div className="flex justify-center px-4 py-10 sm:px-6 sm:py-16">
        <Reveal className="w-full max-w-md">{children}</Reveal>
      </div>
      <aside className="bg-primary text-primary-foreground relative hidden overflow-hidden p-12 lg:flex lg:flex-col lg:justify-center">
        <div aria-hidden className="absolute -top-24 -right-24 size-80 rounded-full bg-[radial-gradient(circle,var(--brand-gold),transparent_68%)] opacity-25" />
        <p className="font-display relative text-3xl leading-tight font-medium text-balance">{t("panelTitle")}</p>
        <ul className="relative mt-8 space-y-4">
          {points.map((point) => (
            <li key={point} className="flex gap-3 leading-relaxed">
              <span aria-hidden className="bg-brand-gold mt-2.5 size-1.5 shrink-0 rounded-full dark:bg-current" />
              {point}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
