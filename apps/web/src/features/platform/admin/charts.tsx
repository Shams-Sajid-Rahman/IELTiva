"use client";

import { useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { stroke: "var(--muted-foreground)", fontSize: 12, tickLine: false, axisLine: false } as const;
const tooltip = {
  // A long course title must wrap. Otherwise the hidden tooltip alone can make a phone page scroll sideways.
  wrapperStyle: { maxWidth: "min(16rem, 70vw)" },
  contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)", fontSize: 13, whiteSpace: "normal" as const },
  labelStyle: { color: "var(--popover-foreground)", fontWeight: 600 },
  itemStyle: { color: "var(--popover-foreground)" },
};

/** The chart is for sighted users, and the matching table carries the same numbers for screen readers. */
function DataTable({ caption, rows }: { caption: string; rows: { label: string; value: number }[] }) {
  const t = useTranslations("app");
  return (
    // Hidden through a wrapper, because browsers ignore the size limits of sr-only on a table itself.
    <div className="sr-only">
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{t("label")}</th>
          <th scope="col">{t("count")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td>{row.label}</td>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

const shortDay = (day: string) => new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(day));

export function TrendChart({ title, seriesName, data }: { title: string; seriesName: string; data: { day: string; count: number }[] }) {
  const t = useTranslations("app");
  const reduced = useReducedMotion();
  const fillId = useId();
  const total = data.reduce((sum, row) => sum + row.count, 0);
  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-display font-semibold">{title}</span>
        <span className="text-muted-foreground text-sm">{t("count_in_this_period", { count: total })}</span>
      </figcaption>
      <div className="h-56 overflow-hidden" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} accessibilityLayer={false}>
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.14} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="day" tickFormatter={shortDay} minTickGap={32} {...axis} />
            <YAxis allowDecimals={false} width={48} {...axis} />
            <Tooltip {...tooltip} cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }} labelFormatter={(label) => shortDay(String(label))} formatter={(value) => [value, seriesName]} />
            <Area type="monotone" dataKey="count" stroke="var(--chart-1)" strokeWidth={2} fill={`url(#${fillId})`} activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} isAnimationActive={!reduced} animationDuration={700} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <DataTable caption={title} rows={data.map((row) => ({ label: row.day, value: row.count }))} />
    </figure>
  );
}

export function PopularityChart({ title, seriesName, data }: { title: string; seriesName: string; data: { title: string; count: number }[] }) {
  const reduced = useReducedMotion();
  return (
    <figure className="min-w-0">
      <figcaption className="font-display mb-3 font-semibold">{title}</figcaption>
      <div className="h-56 overflow-hidden" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} accessibilityLayer={false}>
            <CartesianGrid horizontal={false} stroke="var(--border)" />
            <XAxis type="number" allowDecimals={false} {...axis} />
            <YAxis type="category" dataKey="title" width={110} tickFormatter={(value: string) => (value.length > 16 ? `${value.slice(0, 15)}...` : value)} {...axis} />
            <Tooltip {...tooltip} cursor={{ fill: "var(--muted)" }} formatter={(value) => [value, seriesName]} />
            <Bar dataKey="count" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={!reduced} animationDuration={700} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable caption={title} rows={data.map((row) => ({ label: row.title, value: row.count }))} />
    </figure>
  );
}
