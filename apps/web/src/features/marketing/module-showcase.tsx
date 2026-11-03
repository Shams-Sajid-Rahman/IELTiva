"use client";

import { BookOpen, Headphones, Mic, PenLine } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Test structure from the verified facts in PROJECT_ARCHITECTURE.md. Segment weights follow each part's length. */
const MODULES = [
  { key: "listening", icon: Headphones, parts: [1, 1, 1, 1] },
  { key: "reading", icon: BookOpen, parts: [1, 1, 1] },
  { key: "writing", icon: PenLine, parts: [1, 2] },
  { key: "speaking", icon: Mic, parts: [4.5, 3.5, 4.5] },
] as const;

export function ModuleShowcase() {
  const t = useTranslations("home.modules");
  return (
    <Tabs defaultValue="listening" orientation="vertical" className="flex-col gap-4 lg:flex-row lg:gap-6">
      <TabsList className="grid h-fit w-full shrink-0 grid-cols-2 gap-1 bg-transparent p-0 sm:grid-cols-4 lg:w-64 lg:grid-cols-1">
        {MODULES.map(({ key, icon: Icon }) => (
          <TabsTrigger key={key} value={key} className="data-[state=active]:bg-card data-[state=active]:shadow-soft dark:data-[state=active]:bg-card h-12 justify-start gap-3 rounded-xl border px-4 text-base lg:h-16">
            <Icon aria-hidden /> {t(`${key}.name`)}
          </TabsTrigger>
        ))}
      </TabsList>
      {MODULES.map(({ key, parts }) => {
        const total = parts.reduce<number>((sum, part) => sum + part, 0);
        return (
          <TabsContent key={key} value={key} className="bg-brand-surface relative min-w-0 overflow-hidden rounded-2xl p-6 sm:p-8 lg:p-10">
            <div aria-hidden className="brand-grid absolute inset-0" />
            <div className="relative">
              <h3 className="text-2xl font-semibold sm:text-3xl">{t(`${key}.headline`)}</h3>
              <p className="text-on-brand-muted mt-2 max-w-2xl leading-relaxed">{t(`${key}.body`)}</p>
              <dl className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-3">
                {(["time", "structure", "detail"] as const).map((fact) => (
                  <div key={fact}>
                    <dt className="text-on-brand-muted text-sm">{t(`labels.${fact}`)}</dt>
                    <dd className="font-display mt-1 text-lg font-semibold sm:text-xl">{t(`${key}.${fact}`)}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-8" role="img" aria-label={t(`${key}.structureLabel`)}>
                <div className="flex gap-1">
                  {parts.map((part, index) => (
                    <motion.div
                      key={index}
                      className="bg-brand-sky h-3 origin-left rounded-[3px]"
                      style={{ width: `${(part / total) * 100}%` }}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.5, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
