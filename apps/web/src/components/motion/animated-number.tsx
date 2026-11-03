"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Counts up to a real value the first time it's seen. The final value is what's rendered,
 * so it's correct without JavaScript, for reduced-motion users, and in anything that reads the page.
 */
export function AnimatedNumber({ value, format = String, className }: { value: number; format?: (value: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const formatter = useRef(format);
  const reduced = useReducedMotion();
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    formatter.current = format;
  });

  // Starts from zero before the first paint when already on screen, so the final value doesn't flash first.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || reduced || value === 0) return;
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.top < window.innerHeight && box.bottom > 0) element.textContent = formatter.current(0);
  }, [reduced, value]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const finish = () => {
      element.textContent = formatter.current(value);
    };
    if (reduced || !inView || value === 0) {
      finish();
      return;
    }
    const controls = animate(0, value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (current) => {
        element.textContent = formatter.current(Math.round(current));
      },
      onComplete: finish,
    });
    return () => controls.stop();
  }, [inView, reduced, value]);

  return (
    <span ref={ref} className={className ? `tabular-nums ${className}` : "tabular-nums"}>
      {format(value)}
    </span>
  );
}
