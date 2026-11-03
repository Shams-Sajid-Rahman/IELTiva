"use client";

import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";
import { useTranslations } from "next-intl";
import { useRef } from "react";

/** The line fills as the visitor scrolls through the steps. Reduced-motion users see it complete. */
export function HowItWorks() {
  const t = useTranslations("home.how");
  const container = useRef<HTMLOListElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: container, offset: ["start 75%", "end 60%"] });
  const scaleY = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });

  return (
    <div className="relative">
      <div aria-hidden className="bg-border absolute top-2 bottom-2 left-[1.1875rem] w-0.5">
        <motion.div className="bg-primary h-full origin-top" style={reduced ? undefined : { scaleY }} />
      </div>
      <ol ref={container} className="relative space-y-10 sm:space-y-14">
      {(["step1", "step2", "step3"] as const).map((key, index) => (
        <li key={key} className="relative flex gap-5 sm:gap-8">
          <span aria-hidden className="bg-primary text-primary-foreground font-display ring-background relative flex size-10 shrink-0 items-center justify-center rounded-full font-semibold ring-4">{index + 1}</span>
          <div className="min-w-0 pt-1">
            <h3 className="text-xl font-semibold sm:text-2xl">{t(`${key}.title`)}</h3>
            <p className="text-muted-foreground mt-2 max-w-2xl leading-relaxed">{t(`${key}.body`)}</p>
          </div>
        </li>
      ))}
      </ol>
    </div>
  );
}
