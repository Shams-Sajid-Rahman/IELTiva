"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { bandUserKeys, overallBand } from "./band";

const SKILLS = ["listening", "reading", "writing", "speaking"] as const;
type Skill = (typeof SKILLS)[number];
const TICKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function SkillSlider({ skill, value, onChange }: { skill: Skill; value: number; onChange: (value: number) => void }) {
  const t = useTranslations("home.calculator");
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <label htmlFor={id} className="font-medium">{t(skill)}</label>
        <output htmlFor={id} className="font-display font-semibold tabular-nums">{value.toFixed(1)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={9}
        step={0.5}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-primary mt-1 h-6 w-full cursor-pointer pointer-coarse:h-10"
      />
    </div>
  );
}

/** Applies the published rounding rule to numbers the visitor enters. It isn't a prediction, and it never touches IELTiva's AI scoring. */
export function BandCalculator() {
  const t = useTranslations("home.calculator");
  const [scores, setScores] = useState<Record<Skill, number>>({ listening: 7, reading: 6.5, writing: 6, speaking: 6.5 });
  const band = overallBand(SKILLS.map((skill) => scores[skill]));
  const { lower, upper } = bandUserKeys(band);
  const description = upper === undefined ? t("user", { name: t(`users.${lower}`) }) : t("between", { lower: t(`users.${lower}`), upper: t(`users.${upper}`) });

  return (
    <section aria-labelledby="calculator-title" className="bg-card text-card-foreground shadow-lift rounded-2xl border p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="calculator-title" className="font-display text-lg font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t("subtitle")}</p>
        </div>
        <div aria-live="polite" className="shrink-0 text-right">
          <p className="sr-only">{t("result", { band: band.toFixed(1) })}</p>
          <div aria-hidden className="font-display text-primary relative h-12 w-20 overflow-hidden text-5xl leading-none font-semibold tabular-nums">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={band} className="absolute right-0" initial={{ y: 28, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -28, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 32 }}>
                {band.toFixed(1)}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div aria-hidden className="mt-5">
        <div className="bg-muted relative h-2.5 rounded-full">
          <motion.div className="bg-primary absolute inset-y-0 left-0 rounded-full" initial={{ width: 0 }} animate={{ width: `${(band / 9) * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 22 }} />
        </div>
        <div className="text-muted-foreground mt-1.5 flex justify-between text-xs tabular-nums">
          {TICKS.map((tick) => <span key={tick}>{tick}</span>)}
        </div>
      </div>
      <p className="mt-3 text-sm font-medium">{description}</p>

      <div className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {SKILLS.map((skill) => (
          <SkillSlider key={skill} skill={skill} value={scores[skill]} onChange={(value) => setScores((current) => ({ ...current, [skill]: value }))} />
        ))}
      </div>
      <p className="text-muted-foreground mt-4 border-t pt-3 text-xs leading-relaxed">{t("note")}</p>
    </section>
  );
}
