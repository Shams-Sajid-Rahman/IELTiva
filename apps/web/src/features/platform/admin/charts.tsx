"use client";

import { useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { stroke: "var(--muted-foreground)", fontSize: 12, tickLine: false, axisLine: false } as const;
const tooltip = {
  contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)", fontSize: 13 },
  labelStyle: { color: "var(--popover-foreground)", fontWeight: 600 },
  itemStyle: { color: "var(--popover-foreground)" },
};

/** The chart is for sighted users, and the matching table carries the same numbers for screen readers. */
function DataTable({ caption, rows }: { caption: string; rows: { label: string; value: number }[] }) {
  const t = useTranslations("app");
  return (
    <table className="sr-only">
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
  );
}

const shortDay = (day: string) => new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(day));

export function TrendChart({ title, seriesName, data }: { title: string; seriesName: string; data: { day: string; count: number }[] }) {
  const t = useTranslations("app");
  const total = data.reduce((sum, row) => sum + row.count, 0);
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-display font-semibold">{title}</span>
        <span className="text-muted-foreground text-sm">{t("count_in_this_period", { count: total })}</span>
      </figcaption>
      <div className="h-56" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} accessibilityLayer={false}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="day" tickFormatter={shortDay} minTickGap={32} {...axis} />
            <YAxis allowDecimals={false} width={48} {...axis} />
            <Tooltip {...tooltip} labelFormatter={(label) => shortDay(String(label))} formatter={(value) => [value, seriesName]} />
            <Line type="monotone" dataKey="count" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 5 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <DataTable caption={title} rows={data.map((row) => ({ label: row.day, value: row.count }))} />
    </figure>
  );
}

export function PopularityChart({ title, seriesName, data }: { title: string; seriesName: string; data: { title: string; count: number }[] }) {
  return (
    <figure className="min-w-0">
      <figcaption className="font-display mb-2 font-semibold">{title}</figcaption>
      <div className="h-56" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} accessibilityLayer={false}>
            <CartesianGrid horizontal={false} stroke="var(--border)" />
            <XAxis type="number" allowDecimals={false} {...axis} />
            <YAxis type="category" dataKey="title" width={110} tickFormatter={(value: string) => (value.length > 16 ? `${value.slice(0, 15)}...` : value)} {...axis} />
            <Tooltip {...tooltip} cursor={{ fill: "var(--muted)" }} formatter={(value) => [value, seriesName]} />
            <Bar dataKey="count" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable caption={title} rows={data.map((row) => ({ label: row.title, value: row.count }))} />
    </figure>
  );
}
