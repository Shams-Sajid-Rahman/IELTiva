"use client";

import { CheckCircle2, ChevronLeft, ChevronRight, Clock, Flag, Info, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/features/platform/ui";
import { cn } from "@/lib/utils";

export function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, totalSeconds);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Counts down from a fixed deadline, so a slow or backgrounded tab can't gain time. */
function Countdown({ seconds, onExpire }: { seconds: number; onExpire: () => void }) {
  const t = useTranslations("exam");
  const [left, setLeft] = useState(seconds);
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  });
  useEffect(() => {
    const deadline = Date.now() + seconds * 1000;
    const timer = setInterval(() => {
      const remaining = Math.round((deadline - Date.now()) / 1000);
      setLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        expire.current();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds]);
  const low = left <= 300;
  return (
    <div role="timer" aria-label={t("timeLeft")} className={cn("font-display inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-semibold tabular-nums sm:text-lg", low && "border-warning text-warning")}>
      <Clock className="size-4" aria-hidden />
      {formatClock(left)}
    </div>
  );
}

export function ExamFrame({
  title,
  seconds,
  finishNote,
  summary,
  footer,
  children,
}: {
  title: string;
  seconds: number;
  /** Shown in the confirmation, for example how many questions are unanswered. */
  finishNote: string;
  /** Shown after finishing. It only counts what the student did, and never a score. */
  summary: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("exam");
  const router = useRouter();
  const [finished, setFinished] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const doneHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (finished) doneHeading.current?.focus();
  }, [finished]);

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <header className="bg-card sticky top-0 z-30 border-b">
        <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-5">
          <span className="hidden sm:inline-flex"><Logo showWordmark={false} /></span>
          <h1 className="font-display min-w-0 flex-1 truncate font-semibold sm:text-lg">{title}</h1>
          {!finished && <Countdown key={attempt} seconds={seconds} onExpire={() => setFinished(true)} />}
          <span className="hidden sm:inline-flex"><ThemeToggle /></span>
          {!finished && (
            <>
              <ConfirmButton label={<><LogOut aria-hidden /><span className="sr-only sm:not-sr-only">{t("exit")}</span></>} title={t("exitTitle")} description={t("exitBody")} confirmLabel={t("exit")} onConfirm={() => router.push("/practice")} variant="ghost" />
              <ConfirmButton label={t("finish")} title={t("finishTitle")} description={finishNote} confirmLabel={t("finish")} onConfirm={() => setFinished(true)} variant="default" />
            </>
          )}
        </div>
        <p className="bg-accent text-accent-foreground flex items-start gap-2 px-3 py-1.5 text-xs sm:items-center sm:px-5">
          <Info className="mt-px size-3.5 shrink-0 sm:mt-0" aria-hidden />
          {t("previewNotice")}
        </p>
      </header>

      {finished ? (
        <main id="main" tabIndex={-1} className="flex flex-1 items-center justify-center p-6 outline-none">
          <div className="animate-in fade-in-0 zoom-in-95 max-w-md text-center duration-300">
            <span className="bg-accent text-success mx-auto flex size-14 items-center justify-center rounded-2xl"><CheckCircle2 className="size-7" aria-hidden /></span>
            <h2 ref={doneHeading} tabIndex={-1} className="mt-4 text-2xl font-semibold outline-none">{t("doneTitle")}</h2>
            <p className="mt-2 font-medium">{summary}</p>
            <p className="text-muted-foreground mt-2 leading-relaxed">{t("doneBody")}</p>
            <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
              <Button asChild><Link href="/practice">{t("backToPractice")}</Link></Button>
              <Button variant="outline" onClick={() => { setFinished(false); setAttempt((value) => value + 1); }}>{t("tryAgain")}</Button>
            </div>
          </div>
        </main>
      ) : (
        <>
          <main id="main" key={attempt} tabIndex={-1} className="animate-in fade-in-0 min-w-0 flex-1 outline-none duration-300 lg:min-h-0 lg:overflow-hidden">{children}</main>
          {footer && <footer className="bg-card sticky bottom-0 z-20 border-t pb-[env(safe-area-inset-bottom)]">{footer}</footer>}
        </>
      )}
    </div>
  );
}

/** Numbered question buttons with answered and flagged states, plus previous and next. */
export function QuestionNavigator({
  numbers,
  current,
  answered,
  flagged,
  onJump,
}: {
  numbers: number[];
  current: number;
  answered: (number: number) => boolean;
  flagged: (number: number) => boolean;
  onJump: (number: number) => void;
}) {
  const t = useTranslations("exam");
  const index = numbers.indexOf(current);
  const describe = (number: number) => {
    const state = [answered(number) ? t("answered") : t("notAnswered"), ...(flagged(number) ? [t("flagged")] : [])].join(", ");
    return t("questionState", { number, state });
  };
  return (
    <nav aria-label={t("questions")} className="flex items-center gap-2 px-3 py-2 sm:px-5">
      <Button variant="outline" size="icon" aria-label={t("previous")} disabled={index <= 0} onClick={() => onJump(numbers[index - 1]!)}><ChevronLeft aria-hidden /></Button>
      <ul className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5 sm:justify-center">
        {numbers.map((number) => (
          <li key={number} className="shrink-0">
            <button
              type="button"
              aria-label={describe(number)}
              aria-current={current === number ? "true" : undefined}
              onClick={() => onJump(number)}
              className={cn(
                "relative size-9 rounded-lg border text-sm font-medium tabular-nums transition-colors pointer-coarse:size-11",
                answered(number) ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                current === number && "border-primary ring-primary ring-1",
              )}
            >
              {number}
              {flagged(number) && <Flag aria-hidden className="text-warning fill-warning absolute -top-1 -right-1 size-3" />}
            </button>
          </li>
        ))}
      </ul>
      <Button variant="outline" size="icon" aria-label={t("next")} disabled={index >= numbers.length - 1} onClick={() => onJump(numbers[index + 1]!)}><ChevronRight aria-hidden /></Button>
    </nav>
  );
}
