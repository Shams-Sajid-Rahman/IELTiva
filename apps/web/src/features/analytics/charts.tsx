"use client";

import { useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Each skill keeps its own colour wherever it appears, so filtering a chart never repaints what's left. */
export const SKILL_COLORS: Record<string, string> = {
  LISTENING: "var(--chart-1)",
  READING: "var(--chart-2)",
  WRITING: "var(--chart-4)",
  SPEAKING: "var(--chart-5)",
};

const axis = { stroke: "var(--muted-foreground)", fontSize: 12, tickLine: false, axisLine: false } as const;
const tooltip = {
  wrapperStyle: { maxWidth: "min(16rem, 70vw)" },
  contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)", fontSize: 13, whiteSpace: "normal" as const },
  labelStyle: { color: "var(--popover-foreground)", fontWeight: 600 },
  itemStyle: { color: "var(--popover-foreground)" },
};

const shortDay = (day: string) => new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(day));

export type ScoreKind = "RAW" | "ESTIMATED" | "REVIEWED";

/** Says how far a number can be relied on. Anything showing a score carries one of these. */
export function KindBadge({ kind }: { kind: ScoreKind }) {
  const t = useTranslations("analytics.kinds");
  return <Badge variant={kind === "REVIEWED" ? "default" : "outline"} className={cn(kind === "ESTIMATED" && "border-warning text-warning")}>{t(kind)}</Badge>;
}

/** Thin lines with a legend and a table for screen readers. A gap in the data stays a gap, and isn't drawn over. */
export function TrendLines({ title, series, rows, unit, labelFor, yDomain }: { title: string; series: string[]; rows: { x: string; values: Record<string, number> }[]; unit: string; labelFor: (key: string) => string; yDomain: [number, number] }) {
  const t = useTranslations("analytics");
  const reduced = useReducedMotion();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const data = useMemo(() => rows.map((row) => ({ x: row.x, ...row.values })), [rows]);
  const toggle = (key: string) => setHidden((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  return (
    <figure className="min-w-0">
      <figcaption className="font-display mb-2 font-semibold">{title}</figcaption>
      {series.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {series.map((key) => (
            <button key={key} type="button" aria-pressed={!hidden.has(key)} onClick={() => toggle(key)} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs pointer-coarse:py-2", hidden.has(key) && "opacity-50")}>
              <span className="size-2.5 rounded-full" style={{ background: SKILL_COLORS[key] ?? "var(--chart-1)" }} aria-hidden />
              {labelFor(key)}
            </button>
          ))}
        </div>
      )}
      <div className="h-64 overflow-hidden" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }} accessibilityLayer={false}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="x" tickFormatter={shortDay} minTickGap={32} {...axis} />
            <YAxis domain={yDomain} width={48} {...axis} />
            <Tooltip {...tooltip} cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }} labelFormatter={(label) => shortDay(String(label))} formatter={(value, name) => [`${String(value)}${unit}`, labelFor(String(name))]} />
            {series.filter((key) => !hidden.has(key)).map((key) => (
              <Line key={key} type="monotone" dataKey={key} stroke={SKILL_COLORS[key] ?? "var(--chart-1)"} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: SKILL_COLORS[key] ?? "var(--chart-1)" }} activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={!reduced} animationDuration={600} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead><tr><th scope="col">{t("week")}</th>{series.map((key) => <th key={key} scope="col">{labelFor(key)}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={`${row.x}-${index}`}><td>{row.x}</td>{series.map((key) => <td key={key}>{row.values[key] === undefined ? "-" : `${row.values[key]}${unit}`}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </figure>
  );
}

/** Horizontal bars for a value out of 100, with the number written beside each. */
export function PercentBars({ label, rows }: { label: string; rows: { key: string; label: string; value: number; hint?: string; color?: string | undefined }[] }) {
  return (
    <ul aria-label={label} className="space-y-3">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 break-words">{row.label}</span>
            <span className="shrink-0 font-medium tabular-nums">{row.value}%</span>
          </div>
          <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full" aria-hidden>
            <div className="h-full rounded-full transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(1, row.value)}%`, background: row.color ?? "var(--chart-1)" }} />
          </div>
          {row.hint && <p className="text-muted-foreground mt-0.5 text-xs">{row.hint}</p>}
        </li>
      ))}
    </ul>
  );
}

const DAY = 86_400_000;

/** A calendar of study days. Darker means more minutes, in one colour only. Days with nothing recorded stay blank. */
export function ActivityCalendar({ activity, today, weeks = 18 }: { activity: { day: string; minutes: number; sessions: number }[]; today: string; weeks?: number }) {
  const t = useTranslations("analytics");
  const byDay = useMemo(() => new Map(activity.map((row) => [row.day, row])), [activity]);
  const end = new Date(`${today}T00:00:00Z`).getTime();
  // Monday-based columns, ending in the week that contains today.
  const lastMonday = end - ((new Date(end).getUTCDay() + 6) % 7) * DAY;
  const first = lastMonday - (weeks - 1) * 7 * DAY;
  const peak = Math.max(1, ...activity.map((row) => row.minutes));
  const shade = (minutes: number) => (minutes <= 0 ? 0 : Math.min(4, Math.ceil((minutes / peak) * 4)));
  const columns = Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const time = first + (week * 7 + weekday) * DAY;
      return { time, day: new Date(time).toISOString().slice(0, 10), future: time > end };
    }),
  );
  return (
    <figure className="min-w-0">
      <figcaption className="font-display mb-3 font-semibold">{t("studyCalendar")}</figcaption>
      <div className="overflow-x-auto pb-1" role="img" aria-label={t("studyCalendarLabel", { days: activity.length })}>
        <div className="flex w-fit gap-[3px]">
          {columns.map((column, index) => (
            <div key={index} className="flex flex-col gap-[3px]">
              {column.map((cell) => {
                const row = byDay.get(cell.day);
                const level = shade(row?.minutes ?? 0);
                return (
                  <span
                    key={cell.day}
                    title={cell.future ? undefined : row ? t("calendarDay", { date: shortDay(cell.day), minutes: row.minutes, sessions: row.sessions }) : t("calendarEmpty", { date: shortDay(cell.day) })}
                    className={cn("size-3 rounded-[3px]", cell.future && "invisible", level === 0 && "bg-muted")}
                    style={level > 0 ? { background: `color-mix(in oklab, var(--chart-1) ${25 + level * 18}%, var(--card))` } : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <figcaption className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
        {t("less")}
        {[1, 2, 3, 4].map((level) => <span key={level} className="size-3 rounded-[3px]" style={{ background: `color-mix(in oklab, var(--chart-1) ${25 + level * 18}%, var(--card))` }} aria-hidden />)}
        {t("more")}
      </figcaption>
    </figure>
  );
}
