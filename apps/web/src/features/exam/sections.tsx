"use client";

import { CheckCircle2, Mic, MicOff, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AudioPlayer } from "./audio-player";
import { ExamFrame, formatClock, QuestionNavigator } from "./exam-frame";
import { QuestionList, useQuestions, type Question } from "./questions";

function useFinishNote(total: number, answered: number) {
  const t = useTranslations("exam");
  const left = total - answered;
  return left > 0 ? t("finishUnanswered", { count: left }) : t("finishAllAnswered");
}

export function ListeningPreview() {
  const t = useTranslations("exam");
  const questions = t.raw("listening.questions") as Question[];
  const state = useQuestions(questions);
  const finishNote = useFinishNote(questions.length, state.answeredCount);
  return (
    <ExamFrame
      title={t("listening.title")}
      seconds={30 * 60}
      finishNote={finishNote}
      summary={t("answeredSummary", { answered: state.answeredCount, total: questions.length })}
      footer={<QuestionNavigator numbers={state.numbers} current={state.current} answered={state.isAnswered} flagged={state.isFlagged} onJump={state.jump} />}
    >
      <div tabIndex={0} role="region" aria-label={t("listening.title")} className="mx-auto h-full w-full max-w-3xl space-y-4 overflow-y-auto p-4 sm:p-6">
        <AudioPlayer />
        <div>
          <h2 className="text-lg font-semibold">{t("listening.partTitle")}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t("listening.instructions")}</p>
        </div>
        <QuestionList questions={questions} state={state} />
      </div>
    </ExamFrame>
  );
}

export function ReadingPreview() {
  const t = useTranslations("exam");
  const questions = t.raw("reading.questions") as Question[];
  const paragraphs = t.raw("reading.paragraphs") as string[];
  const state = useQuestions(questions);
  const finishNote = useFinishNote(questions.length, state.answeredCount);
  const [view, setView] = useState<"passage" | "questions">("passage");
  return (
    <ExamFrame
      title={t("reading.title")}
      seconds={60 * 60}
      finishNote={finishNote}
      summary={t("answeredSummary", { answered: state.answeredCount, total: questions.length })}
      footer={<QuestionNavigator numbers={state.numbers} current={state.current} answered={state.isAnswered} flagged={state.isFlagged} onJump={(id) => { setView("questions"); state.jump(id); }} />}
    >
      {/* Phones show one pane at a time. Larger screens show the passage and questions side by side. */}
      <div role="group" aria-label={t("reading.viewLabel")} className="bg-muted m-3 grid grid-cols-2 gap-1 rounded-lg p-1 lg:hidden">
        {(["passage", "questions"] as const).map((key) => (
          <Button key={key} size="sm" variant={view === key ? "default" : "ghost"} aria-pressed={view === key} onClick={() => setView(key)}>{t(`reading.${key}`)}</Button>
        ))}
      </div>
      <div className="lg:grid lg:h-full lg:grid-cols-2 lg:divide-x">
        <article tabIndex={0} aria-labelledby="passage-title" className={cn("overflow-y-auto p-4 sm:p-6 lg:block lg:p-8", view === "passage" ? "block" : "hidden")}>
          <div className="mx-auto max-w-prose">
            <h2 id="passage-title" className="text-xl font-semibold sm:text-2xl">{t("reading.passageTitle")}</h2>
            <div className="mt-4 space-y-4 leading-[1.75]">
              {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
          </div>
        </article>
        <section tabIndex={0} aria-label={t("reading.questions")} className={cn("bg-background overflow-y-auto p-4 sm:p-6 lg:block", view === "questions" ? "block" : "hidden")}>
          <p className="text-muted-foreground mb-3 text-sm">{t("reading.instructions")}</p>
          <QuestionList questions={questions} state={state} />
        </section>
      </div>
    </ExamFrame>
  );
}

const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
const countParagraphs = (text: string) => text.split(/\n\s*\n/).filter((block) => block.trim()).length;

function WritingEditor({ task, value, onChange }: { task: "task1" | "task2"; value: string; onChange: (value: string) => void }) {
  const t = useTranslations("exam.writing");
  const minimum = task === "task1" ? 150 : 250;
  const words = useMemo(() => countWords(value), [value]);
  const reached = words >= minimum;
  return (
    <div className="flex h-full min-h-[24rem] flex-col">
      <Label htmlFor={`editor-${task}`} className="sr-only">{t("answerLabel", { task: t(`${task}.name`) })}</Label>
      <Textarea
        id={`editor-${task}`}
        spellCheck={false}
        value={value}
        placeholder={t("placeholder")}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-64 flex-1 resize-none rounded-b-none text-[1.0625rem] leading-[1.75] field-sizing-fixed"
      />
      <div className="bg-card rounded-b-md border border-t-0 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
          <p className="font-medium tabular-nums"><span>{t("wordCount", { words, minimum })}</span></p>
          <p className="text-muted-foreground tabular-nums">{t("paragraphCount", { count: countParagraphs(value) })}</p>
          <p aria-live="polite" className={cn("inline-flex items-center gap-1 font-medium", reached ? "text-success" : "text-muted-foreground")}>
            {reached && <CheckCircle2 className="size-4" aria-hidden />}
            {reached ? t("minimumReached") : t("wordsToGo", { count: minimum - words })}
          </p>
        </div>
        <Progress className="mt-2" value={Math.min(100, (words / minimum) * 100)} aria-label={t("towardsMinimum")} />
      </div>
    </div>
  );
}

export function WritingPreview() {
  const t = useTranslations("exam");
  const [text, setText] = useState({ task1: "", task2: "" });
  const rows = t.raw("writing.task1.rows") as string[][];
  const words = countWords(text.task1) + countWords(text.task2);
  const blank = [text.task1, text.task2].filter((value) => !value.trim()).length;
  return (
    <ExamFrame title={t("writing.title")} seconds={60 * 60} finishNote={blank ? t("writing.finishBlank", { count: blank }) : t("finishAllAnswered")} summary={t("writing.summary", { words })}>
      <Tabs defaultValue="task1" className="h-full gap-0">
        <div className="border-b px-3 py-2 sm:px-5">
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="task1">{t("writing.task1.name")}</TabsTrigger>
            <TabsTrigger value="task2">{t("writing.task2.name")}</TabsTrigger>
          </TabsList>
        </div>
        {(["task1", "task2"] as const).map((task) => (
          <TabsContent key={task} value={task} className="min-h-0 lg:grid lg:grid-cols-[2fr_3fr] lg:divide-x">
            <section tabIndex={0} aria-label={t("writing.promptLabel")} className="overflow-y-auto p-4 sm:p-6">
              <p className="text-muted-foreground text-sm">{t(`writing.${task}.guide`)}</p>
              <h2 className="mt-3 text-lg leading-snug font-semibold">{t(`writing.${task}.prompt`)}</h2>
              {task === "task1" && (
                <div className="mt-4 overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <caption className="text-muted-foreground p-2 text-left text-xs">{t("writing.task1.caption")}</caption>
                    <thead><tr>{(t.raw("writing.task1.head") as string[]).map((heading) => <th key={heading} scope="col" className="border-y px-3 py-2 text-left font-semibold">{heading}</th>)}</tr></thead>
                    <tbody>{rows.map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell} className="border-b px-3 py-2 tabular-nums last:border-b">{cell}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </section>
            <div className="p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
              <WritingEditor task={task} value={text[task]} onChange={(value) => setText((all) => ({ ...all, [task]: value }))} />
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </ExamFrame>
  );
}

type RecordingStage = "idle" | "preparing" | "recording" | "done";

/** Walks through the recording flow without using the microphone. No audio is captured in this preview. */
function RecorderPreview({ prepare, limit }: { prepare: number; limit: number }) {
  const t = useTranslations("exam.speaking");
  const [stage, setStage] = useState<RecordingStage>("idle");
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (stage !== "preparing" && stage !== "recording") return;
    const timer = setInterval(() => {
      setLeft((value) => {
        if (value > 1) return value - 1;
        setStage((current) => (current === "preparing" ? "recording" : "done"));
        return limit;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [limit, stage]);

  const start = () => {
    if (prepare > 0) {
      setLeft(prepare);
      setStage("preparing");
    } else {
      setLeft(limit);
      setStage("recording");
    }
  };

  return (
    <section aria-label={t("recorder")} className="bg-card shadow-soft rounded-xl border p-5">
      <p className="text-muted-foreground flex items-start gap-2 text-sm"><MicOff className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("micOff")}</p>
      <div aria-hidden className={cn("waveform mt-5 flex h-14 items-center justify-center gap-1", stage !== "recording" && "opacity-30 [&_span]:[animation:none]")}>
        {Array.from({ length: 28 }, (_, index) => (
          <span key={index} className="bg-primary h-full w-1 rounded-full" style={{ animationDelay: `${(index % 7) * 0.09}s`, transform: stage === "recording" ? undefined : "scaleY(0.25)" }} />
        ))}
      </div>
      <p aria-live="polite" className="mt-4 text-center font-medium">
        {stage === "idle" && t("ready")}
        {stage === "preparing" && t("preparing")}
        {stage === "recording" && t("speakNow")}
        {stage === "done" && t("finishedPart")}
      </p>
      {(stage === "preparing" || stage === "recording") && <p role="timer" className="font-display mt-1 text-center text-3xl font-semibold tabular-nums">{formatClock(left)}</p>}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {stage === "idle" && <Button size="lg" onClick={start}><Mic aria-hidden /> {prepare > 0 ? t("startPreparing") : t("startSpeaking")}</Button>}
        {stage === "preparing" && <Button size="lg" onClick={() => { setLeft(limit); setStage("recording"); }}><Mic aria-hidden /> {t("startSpeaking")}</Button>}
        {stage === "recording" && <Button size="lg" variant="destructive" onClick={() => setStage("done")}><Square aria-hidden /> {t("stop")}</Button>}
        {stage === "done" && <Button variant="outline" onClick={() => setStage("idle")}>{t("again")}</Button>}
      </div>
    </section>
  );
}

const SPEAKING_PARTS = [
  { key: "part1", prepare: 0, limit: 5 * 60 },
  { key: "part2", prepare: 60, limit: 2 * 60 },
  { key: "part3", prepare: 0, limit: 5 * 60 },
] as const;

export function SpeakingPreview() {
  const t = useTranslations("exam");
  return (
    <ExamFrame title={t("speaking.title")} seconds={14 * 60} finishNote={t("speaking.finishNote")} summary={t("speaking.summary")}>
      <div tabIndex={0} role="region" aria-label={t("speaking.title")} className="mx-auto h-full w-full max-w-3xl overflow-y-auto p-4 sm:p-6">
        <Tabs defaultValue="part1" className="gap-4">
          <TabsList className="w-full">
            {SPEAKING_PARTS.map(({ key }) => <TabsTrigger key={key} value={key}>{t(`speaking.${key}.name`)}</TabsTrigger>)}
          </TabsList>
          {SPEAKING_PARTS.map(({ key, prepare, limit }) => (
            <TabsContent key={key} value={key} className="space-y-4">
              <div>
                <Badge variant="secondary">{t(`speaking.${key}.time`)}</Badge>
                <h2 className="mt-3 text-xl font-semibold">{t(`speaking.${key}.heading`)}</h2>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed">
                  {(t.raw(`speaking.${key}.points`) as string[]).map((point) => <li key={point}>{point}</li>)}
                </ul>
              </div>
              <RecorderPreview prepare={prepare} limit={limit} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </ExamFrame>
  );
}
