import { cn } from "@/lib/utils";

/** The only place the IELTiva mark and wordmark are defined, so a rename touches one file. */
export function Logo({ className, showWordmark = true }: { className?: string; showWordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="9" className="fill-[#101d3a] dark:fill-[#2458d3]" />
        <path d="M9 23V9" className="stroke-[#f5f7fc]" strokeWidth="3" strokeLinecap="round" />
        <path d="M15 9l4.5 14L24 9" fill="none" className="stroke-[#8db5ff] dark:stroke-[#f5f7fc]" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {showWordmark && <span className="font-display text-xl font-semibold tracking-tight">IELTiva</span>}
    </span>
  );
}
