"use client";

import { CalendarCheck, CheckCircle2, Clock, Flag, GraduationCap, PenLine, Target } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const DEMOS = [
  { key: "courses", icon: GraduationCap, ready: true },
  { key: "planner", icon: CalendarCheck, ready: true },
  { key: "practice", icon: Target, ready: false },
  { key: "writing", icon: PenLine, ready: false },
] as const;

function CoursesDemo() {
  const t = useTranslations("home.demos.courses");
  const rows = [
    { key: "row1", value: 80 },
    { key: "row2", value: 45 },
    { key: "row3", value: 15 },
  ];
  return (
    <ul className="space-y-4">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex justify-between gap-3 text-sm">
            <span className="font-medium">{t(row.key)}</span>
            <span className="text-muted-foreground tabular-nums">{row.value}%</span>
          </div>
          <Progress className="mt-2" value={row.value} aria-label={t(row.key)} />
        </li>
      ))}
    </ul>
  );
}

function PlannerDemo() {
  const t = useTranslations("home.demos.planner");
  const [done, setDone] = useState<string[]>(["task1"]);
  return (
    <ul className="divide-y">
      {["task1", "task2", "task3"].map((key) => {
        const checked = done.includes(key);
        return (
          <li key={key} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <Checkbox id={`demo-${key}`} checked={checked} onCheckedChange={(next) => setDone((current) => (next ? [...current, key] : current.filter((value) => value !== key)))} />
            <Label htmlFor={`demo-${key}`} className={cn("transition-colors", checked && "text-muted-foreground line-through")}>{t(key)}</Label>
          </li>
        );
      })}
    </ul>
  );
}

function PracticeDemo() {
  const t = useTranslations("home.demos.practice");
  const [current, setCurrent] = useState(3);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{t("section")}</span>
        <span className="inline-flex items-center gap-1.5 font-medium tabular-nums"><Clock className="size-4" aria-hidden /> 18:42</span>
      </div>
      <p className="text-muted-foreground mt-3 text-sm">{t("hint")}</p>
      <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-10">
        {Array.from({ length: 10 }, (_, index) => index + 1).map((number) => (
          <button
            key={number}
            type="button"
            aria-pressed={current === number}
            aria-label={t("question", { number })}
            onClick={() => setCurrent(number)}
            className={cn("h-10 rounded-lg border text-sm font-medium tabular-nums transition-colors", current === number ? "bg-primary text-primary-foreground border-primary" : number < 3 ? "bg-accent text-accent-foreground" : "hover:bg-muted")}
          >
            {number}
          </button>
        ))}
      </div>
      <p className="text-muted-foreground mt-3 inline-flex items-center gap-1.5 text-sm"><Flag className="size-4" aria-hidden /> {t("flag")}</p>
    </div>
  );
}

function WritingDemo() {
  const t = useTranslations("home.demos.writing");
  const criteria = ["task", "coherence", "lexical", "grammar"] as const;
  const [active, setActive] = useState<(typeof criteria)[number]>("coherence");
  return (
    <div>
      <p className="bg-muted rounded-lg p-3 text-sm leading-relaxed">{t("sample")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {criteria.map((key) => (
          <button key={key} type="button" aria-pressed={active === key} onClick={() => setActive(key)} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors pointer-coarse:py-2.5", active === key ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted")}>
            {t(`criteria.${key}`)}
          </button>
        ))}
      </div>
      <p key={active} aria-live="polite" className="animate-in fade-in-0 mt-3 text-sm leading-relaxed duration-200">{t(`feedback.${active}`)}</p>
    </div>
  );
}

const PANELS = { courses: CoursesDemo, planner: PlannerDemo, practice: PracticeDemo, writing: WritingDemo };

/** Small working samples of the product. Each says whether it's available today, and none of them shows a band. */
export function ProductDemos() {
  const t = useTranslations("home.demos");
  return (
    <Tabs defaultValue="courses" className="gap-6">
      <TabsList className="grid h-auto w-full grid-cols-2 gap-1 md:grid-cols-4 group-data-[orientation=horizontal]/tabs:h-auto">
        {DEMOS.map(({ key, icon: Icon }) => (
          <TabsTrigger key={key} value={key} className="h-11 whitespace-normal">
            <Icon aria-hidden /> {t(`${key}.tab`)}
          </TabsTrigger>
        ))}
      </TabsList>
      {DEMOS.map(({ key, ready }) => {
        const Panel = PANELS[key];
        return (
          <TabsContent key={key} value={key} className="grid gap-8 lg:grid-cols-[1fr_1.15fr] lg:items-center">
            <div>
              <Badge variant={ready ? "default" : "secondary"} className={ready ? "bg-success text-success-foreground" : undefined}>
                {ready ? <CheckCircle2 aria-hidden /> : <Clock aria-hidden />} {ready ? t("available") : t("inDevelopment")}
              </Badge>
              <h3 className="mt-3 text-2xl font-semibold">{t(`${key}.title`)}</h3>
              <p className="text-muted-foreground mt-2 leading-relaxed">{t(`${key}.body`)}</p>
            </div>
            <div className="bg-card shadow-soft rounded-2xl border p-5 sm:p-6">
              <Panel />
              <p className="text-muted-foreground mt-4 border-t pt-3 text-xs">{t("sampleNote")}</p>
            </div>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
