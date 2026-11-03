"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A circular progress meter. Its label carries the value for screen readers, and the ring is decorative. */
export function ProgressRing({
  value,
  label,
  size = 96,
  stroke = 8,
  className,
  trackClassName = "stroke-muted",
  barClassName = "stroke-primary",
  children,
}: {
  value: number;
  label: string;
  size?: number;
  stroke?: number;
  className?: string;
  trackClassName?: string;
  barClassName?: string;
  children?: ReactNode;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(Math.min(100, Math.max(0, value))));
    return () => cancelAnimationFrame(frame);
  }, [value]);
  const radius = (size - stroke) / 2;

  return (
    <div role="group" aria-label={label} className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg aria-hidden viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className={trackClassName} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={100}
          strokeDashoffset={100 - shown}
          className={cn("transition-[stroke-dashoffset] duration-1000 ease-out", barClassName)}
        />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}
