"use client";

import type { AnswerResponse } from "@ieltiva/shared";
import { AlertTriangle, CheckCircle2, Circle, CircleDot, Clock, CloudOff, Highlighter, Info, ListChecks, LogOut, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useLabels } from "@/features/platform/labels";
import { ConfirmButton, ErrorBlock } from "@/features/platform/ui";
import { api, ApiRequestError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Countdown, formatClock, QuestionNavigator } from "./exam-frame";
import { hasAnswer, PrivateImage, QuestionGroupView, type AnswerEntry } from "./question-renderer";
import { Recorder } from "./recorder";
import type { AttemptView, AudioView, SectionPayload, SpeakingQuestionView } from "./types";
import { durationLabel } from "./types";
import { useAutosave, type SaveStatus } from "./use-autosave";

const secondsLeft = (expiresAt: string | null, serverTime: string) => (expiresAt ? Math.max(0, Math.round((new Date(expiresAt).getTime() - new Date(serverTime).getTime()) / 1000)) : null);

function SaveIndicator({ status, savedAt }: { status: SaveStatus; savedAt: Date | null }) {
  const t = useTranslations("practice.save");
  const time = savedAt ? new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(savedAt) : "";
  return (
    <p role="status" className={cn("hidden items-center gap-1.5 text-xs sm:inline-flex", status === "offline" ? "text-destructive font-medium" : "text-muted-foreground")}>
      {status === "offline" && <CloudOff className="size-3.5" aria-hidden />}
      {status === "idle" && t("idle")}
      {status === "pending" && t("pending")}
      {status === "saving" && t("saving")}
      {status === "saved" && t("saved", { time })}
      {status === "offline" && t("offline")}
      {status === "closed" && t("closed")}
    </p>
  );
}

/** The exam screen's frame: no site navigation, one clock, one save status, and the way out. */
function Frame({ title, seconds, status, savedAt, onExpire, finishLabel, finishNote, onFinish, onExit, footer, children }: { title: string; seconds: number | null; status: SaveStatus; savedAt: Date | null; onExpire: () => void; finishLabel: string; finishNote: string; onFinish: () => void; onExit: () => void; footer?: ReactNode; children: ReactNode }) {
  const t = useTranslations("practice");
  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <header className="bg-card sticky top-0 z-30 border-b">
        <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-5">
          <span className="hidden sm:inline-flex"><Logo showWordmark={false} /></span>
          <h1 className="font-display min-w-0 flex-1 truncate font-semibold sm:text-lg">{title}</h1>
          <SaveIndicator status={status} savedAt={savedAt} />
          {seconds !== null && <Countdown seconds={seconds} onExpire={onExpire} />}
          <Button variant="ghost" size="sm" onClick={onExit}><LogOut aria-hidden /><span className="sr-only sm:not-sr-only">{t("leaveSection")}</span></Button>
          <ConfirmButton label={finishLabel} title={t("finishSectionTitle")} description={finishNote} confirmLabel={finishLabel} onConfirm={onFinish} variant="default" />
        </div>
        {status === "offline" && (
          <p role="alert" className="bg-destructive/10 text-destructive flex items-center gap-2 px-3 py-1.5 text-xs font-medium sm:hidden"><CloudOff className="size-3.5" aria-hidden /> {t("save.offline")}</p>
        )}
      </header>
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none lg:min-h-0 lg:overflow-hidden">{children}</main>
      {footer && <footer className="bg-card sticky bottom-0 z-20 border-t pb-[env(safe-area-inset-bottom)]">{footer}</footer>}
    </div>
  );
}

/** Shared by Listening and Reading: holds the answers, saves them, and restores anything unsaved after a reload. */
function useObjectiveAnswers(payload: SectionPayload, onClosed: () => void) {
  const { attempt, section } = payload;
  const questions = useMemo(() => section.questionGroups.flatMap((group) => group.questions), [section.questionGroups]);
  const base = `/attempts/${attempt.id}/sections/${section.id}`;
  const autosave = useAutosave<{ response?: AnswerResponse | null; isFlagged?: boolean }>({
    storageKey: `ieltiva_answers_${attempt.id}_${section.id}`,
    save: (changes) => api.put(`${base}/answers`, { answers: Object.entries(changes).map(([questionId, change]) => ({ questionId, ...change })) }),
    onClosed,
  });
  const [answers, setAnswers] = useState<Record<string, AnswerEntry>>(() => Object.fromEntries(payload.responses.map((row) => [row.questionId, { response: row.response, isFlagged: row.isFlagged }])));
  const [current, setCurrent] = useState(questions[0]?.id);

  // Shows work that was queued but not saved before a reload. The queue itself sends it.
  useEffect(() => {
    const unsaved = autosave.restored();
    if (!Object.keys(unsaved).length) return;
    queueMicrotask(() =>
      setAnswers((all) => {
        const next = { ...all };
        for (const [id, change] of Object.entries(unsaved)) next[id] = { response: change.response !== undefined ? change.response : (all[id]?.response ?? null), isFlagged: change.isFlagged ?? all[id]?.isFlagged ?? false };
        return next;
      }),
    );
  }, [autosave.restored]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = (id: string, response: AnswerResponse) => {
    setAnswers((all) => ({ ...all, [id]: { response, isFlagged: all[id]?.isFlagged ?? false } }));
    autosave.queue(id, { response, ...(answers[id]?.isFlagged ? { isFlagged: true } : {}) });
  };
  const flag = (id: string) => {
    const isFlagged = !answers[id]?.isFlagged;
    setAnswers((all) => ({ ...all, [id]: { response: all[id]?.response ?? null, isFlagged } }));
    autosave.queue(id, { ...(answers[id]?.response ? { response: answers[id]!.response } : {}), isFlagged });
  };
  const jump = (id: string) => {
    setCurrent(id);
    document.getElementById(`q-${id}`)?.scrollIntoView({ block: "center" });
  };
  const answered = questions.filter((question) => hasAnswer(answers[question.id])).length;
  return { questions, answers, current, setCurrent, answer, flag, jump, answered, autosave, base };
}

function ReviewAnswers({ state, onJump }: { state: ReturnType<typeof useObjectiveAnswers>; onJump: (id: string) => void }) {
  const t = useTranslations("practice");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><ListChecks aria-hidden /> <span className="hidden sm:inline">{t("reviewAnswers")}</span><span className="sr-only sm:hidden">{t("reviewAnswers")}</span></Button></DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("reviewAnswers")}</DialogTitle>
          <DialogDescription>{t("answeredOf", { answered: state.answered, total: state.questions.length })}</DialogDescription>
        </DialogHeader>
        <ul className="divide-y">
          {state.questions.map((question) => {
            const entry = state.answers[question.id];
            const response = entry?.response;
            const text = !hasAnswer(entry) ? t("notAnswered") : response && "text" in response ? response.text : response && "selected" in response ? response.selected.join(", ") : "";
            return (
              <li key={question.id}>
                <button type="button" className="hover:bg-muted flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left text-sm" onClick={() => { setOpen(false); onJump(question.id); }}>
                  <span className="w-6 shrink-0 font-semibold tabular-nums">{question.number}</span>
                  <span className={cn("min-w-0 flex-1 break-words", !hasAnswer(entry) && "text-muted-foreground")}>{text}</span>
                  {entry?.isFlagged && <span className="text-warning text-xs font-medium">{t("flagged")}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** Plays private audio fetched through the API. The server counts each play, so a reload can't add more. */
function AudioPlayer({ audio, base, limit, allowSeek, disabled }: { audio: AudioView; base: string; limit: number | null; allowSeek: boolean; disabled?: boolean }) {
  const t = useTranslations("practice.audio");
  const element = useRef<HTMLAudioElement>(null);
  const positionKey = `ieltiva_audio_${base}_${audio.id}`;
  const [source, setSource] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [used, setUsed] = useState(audio.playsUsed);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => {
    if (source) URL.revokeObjectURL(source);
  }, [source]);

  const savedPosition = () => {
    try {
      return Number(sessionStorage.getItem(positionKey) ?? 0);
    } catch {
      return 0;
    }
  };
  // Mid-way through a limited play, a reload can pick up where it stopped without using another play.
  const canResume = used > 0 && !source && !ended && savedPosition() > 0;
  const exhausted = limit !== null && used >= limit && !canResume && !source;

  async function load(counted: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (counted) {
        const result = await api.post<{ playsUsed: number }>(`${base}/audio/${audio.id}/play`);
        setUsed(result.playsUsed);
      }
      const blob = await api.getBlob(`${base}/audio/${audio.id}`);
      setEnded(false);
      setSource((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  function toggle() {
    const player = element.current;
    if (playing && player) {
      if (allowSeek) player.pause();
      return;
    }
    if (source && player && !ended) void player.play();
    else void load(!canResume);
  }

  return (
    <section aria-label={t("label", { number: audio.position })} className="bg-card shadow-soft rounded-xl border p-4">
      {/* Transcripts appear in the review after submission, because showing them now would give the answers away. */}
      <audio
        ref={element}
        src={source ?? undefined}
        onCanPlay={(event) => {
          if (!playing && event.currentTarget.paused && !ended) {
            if (canResume || savedPosition() > 0) event.currentTarget.currentTime = savedPosition();
            void event.currentTarget.play().catch(() => {});
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setEnded(true);
          setTime(0);
          try {
            sessionStorage.removeItem(positionKey);
          } catch {
            // Nothing to clear.
          }
          setSource(null);
        }}
        onTimeUpdate={(event) => {
          const position = event.currentTarget.currentTime;
          setTime(position);
          try {
            sessionStorage.setItem(positionKey, String(position));
          } catch {
            // The position just isn't kept across a reload.
          }
        }}
      />
      <div className="flex items-center gap-3">
        <Button size="icon" aria-label={playing ? (allowSeek ? t("pause") : t("playing")) : canResume ? t("resume") : t("play")} disabled={disabled || busy || exhausted || (playing && !allowSeek)} onClick={toggle} className="size-11 shrink-0 rounded-full">
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-medium">{t("label", { number: audio.position })}</span>
            <span className="text-muted-foreground shrink-0 tabular-nums">{formatClock(Math.round(time))} / {formatClock(audio.durationSeconds)}</span>
          </div>
          <Progress className="mt-2" value={Math.min(100, (time / audio.durationSeconds) * 100)} aria-label={t("played")} />
        </div>
      </div>
      <p className="text-muted-foreground mt-3 text-xs">{limit === null ? t("noLimit") : t("playsUsed", { used, limit })}</p>
      {error && <p role="alert" className="text-destructive mt-2 flex items-center gap-1.5 text-sm"><AlertTriangle className="size-4" aria-hidden /> {error}</p>}
    </section>
  );
}

function ListeningRunner({ payload, onFinish, onExit, onClosed }: RunnerProps) {
  const t = useTranslations("practice");
  const state = useObjectiveAnswers(payload, onClosed);
  const { section } = payload;
  const finish = async () => {
    await state.autosave.flush();
    onFinish();
  };
  return (
    <Frame
      title={section.title}
      seconds={secondsLeft(payload.expiresAt, payload.serverTime)}
      status={state.autosave.status}
      savedAt={state.autosave.savedAt}
      onExpire={() => void finish()}
      finishLabel={t("finishSection")}
      finishNote={t("finishNote", { count: state.questions.length - state.answered })}
      onFinish={() => void finish()}
      onExit={() => void state.autosave.flush().then(onExit)}
      footer={<div className="flex items-center"><div className="min-w-0 flex-1"><QuestionNavigator numbers={state.questions.map((question) => question.number)} current={state.questions.find((question) => question.id === state.current)?.number ?? 1} answered={(number) => hasAnswer(state.answers[state.questions.find((question) => question.number === number)?.id ?? ""])} flagged={(number) => Boolean(state.answers[state.questions.find((question) => question.number === number)?.id ?? ""]?.isFlagged)} onJump={(number) => { const question = state.questions.find((row) => row.number === number); if (question) state.jump(question.id); }} /></div><div className="pr-3"><ReviewAnswers state={state} onJump={state.jump} /></div></div>}
    >
      <div tabIndex={0} role="region" aria-label={section.title} className="mx-auto h-full w-full max-w-3xl space-y-4 overflow-y-auto p-4 sm:p-6">
        {section.instructions && <p className="text-muted-foreground text-sm whitespace-pre-wrap">{section.instructions}</p>}
        {section.listeningAudios.map((audio) => <AudioPlayer key={audio.id} audio={audio} base={state.base} limit={section.maxAudioPlays} allowSeek={section.allowAudioSeek} />)}
        {section.questionGroups.map((group) => <QuestionGroupView key={group.id} group={group} imagePath={`${state.base}/groups/${group.id}/image`} answers={state.answers} current={state.current} onAnswer={state.answer} onFlag={state.flag} onFocus={state.setCurrent} />)}
      </div>
    </Frame>
  );
}

type Mark = { start: number; end: number };

/** Highlights stay in this tab only. They're a reading aid, so they're never saved to the server. */
function Passage({ passage, storageKey }: { passage: { id: string; title: string; body: string }; storageKey: string }) {
  const t = useTranslations("practice");
  const key = `${storageKey}_${passage.id}`;
  const container = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState<Mark[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) ?? "[]") as Mark[];
      if (stored.length) queueMicrotask(() => setMarks(stored));
    } catch {
      // Highlights just start empty.
    }
  }, [key]);

  const store = (next: Mark[]) => {
    setMarks(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Highlights just aren't kept across a reload.
    }
  };

  const offsetOf = (node: Node, offset: number) => {
    const root = container.current!;
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
  };

  function highlight() {
    const selection = window.getSelection();
    const root = container.current;
    if (!selection || selection.isCollapsed || !root || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
      toast.info(t("selectFirst"));
      return;
    }
    const a = offsetOf(selection.anchorNode!, selection.anchorOffset);
    const b = offsetOf(selection.focusNode!, selection.focusOffset);
    store([...marks, { start: Math.min(a, b), end: Math.max(a, b) }]);
    selection.removeAllRanges();
  }

  const pieces = useMemo(() => {
    const cuts = [...marks].sort((x, y) => x.start - y.start);
    const merged: Mark[] = [];
    for (const mark of cuts) {
      const last = merged.at(-1);
      if (last && mark.start <= last.end) last.end = Math.max(last.end, mark.end);
      else merged.push({ ...mark });
    }
    const out: { text: string; marked: boolean }[] = [];
    let cursor = 0;
    for (const mark of merged) {
      if (mark.start > cursor) out.push({ text: passage.body.slice(cursor, mark.start), marked: false });
      out.push({ text: passage.body.slice(mark.start, mark.end), marked: true });
      cursor = mark.end;
    }
    if (cursor < passage.body.length) out.push({ text: passage.body.slice(cursor), marked: false });
    return out;
  }, [marks, passage.body]);

  return (
    <article className="mb-8">
      <h2 className="text-xl font-semibold sm:text-2xl">{passage.title}</h2>
      <div className="mt-2 mb-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={highlight}><Highlighter aria-hidden /> {t("highlight")}</Button>
        {marks.length > 0 && <Button variant="ghost" size="sm" onClick={() => store([])}>{t("clearHighlights")}</Button>}
      </div>
      <div ref={container} className="leading-[1.75] whitespace-pre-wrap">
        {pieces.map((piece, index) => (piece.marked ? <mark key={index} className="bg-brand-sky/50 text-foreground rounded-sm">{piece.text}</mark> : <span key={index}>{piece.text}</span>))}
      </div>
    </article>
  );
}

function ReadingRunner({ payload, onFinish, onExit, onClosed }: RunnerProps) {
  const t = useTranslations("practice");
  const state = useObjectiveAnswers(payload, onClosed);
  const { section, attempt } = payload;
  const [view, setView] = useState<"passage" | "questions">("passage");
  const notesKey = `ieltiva_notes_${attempt.id}_${section.id}`;
  const [notes, setNotes] = useState("");
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(notesKey);
      if (stored) queueMicrotask(() => setNotes(stored));
    } catch {
      // Notes just start empty.
    }
  }, [notesKey]);
  const finish = async () => {
    await state.autosave.flush();
    onFinish();
  };
  const byNumber = (number: number) => state.questions.find((question) => question.number === number);
  return (
    <Frame
      title={section.title}
      seconds={secondsLeft(payload.expiresAt, payload.serverTime)}
      status={state.autosave.status}
      savedAt={state.autosave.savedAt}
      onExpire={() => void finish()}
      finishLabel={t("finishSection")}
      finishNote={t("finishNote", { count: state.questions.length - state.answered })}
      onFinish={() => void finish()}
      onExit={() => void state.autosave.flush().then(onExit)}
      footer={<div className="flex items-center"><div className="min-w-0 flex-1"><QuestionNavigator numbers={state.questions.map((question) => question.number)} current={state.questions.find((question) => question.id === state.current)?.number ?? 1} answered={(number) => hasAnswer(state.answers[byNumber(number)?.id ?? ""])} flagged={(number) => Boolean(state.answers[byNumber(number)?.id ?? ""]?.isFlagged)} onJump={(number) => { const question = byNumber(number); if (question) { setView("questions"); requestAnimationFrame(() => state.jump(question.id)); } }} /></div><div className="pr-3"><ReviewAnswers state={state} onJump={(id) => { setView("questions"); requestAnimationFrame(() => state.jump(id)); }} /></div></div>}
    >
      <div role="group" aria-label={t("chooseView")} className="bg-muted m-3 grid grid-cols-2 gap-1 rounded-lg p-1 lg:hidden">
        {(["passage", "questions"] as const).map((key) => <Button key={key} size="sm" variant={view === key ? "default" : "ghost"} aria-pressed={view === key} onClick={() => setView(key)}>{t(key)}</Button>)}
      </div>
      <div className="lg:grid lg:h-full lg:grid-cols-2 lg:divide-x">
        <div tabIndex={0} role="region" aria-label={t("passage")} className={cn("min-w-0 overflow-y-auto p-4 sm:p-6 lg:block lg:p-8", view === "passage" ? "block" : "hidden")}>
          <div className="mx-auto max-w-prose">
            {section.instructions && <p className="text-muted-foreground mb-4 text-sm whitespace-pre-wrap">{section.instructions}</p>}
            {section.readingPassages.map((passage) => <Passage key={passage.id} passage={passage} storageKey={`ieltiva_marks_${attempt.id}`} />)}
            <div className="border-t pt-4">
              <Label htmlFor="reading-notes">{t("notes")}</Label>
              <Textarea
                id="reading-notes"
                rows={3}
                className="mt-2"
                value={notes}
                placeholder={t("notesHint")}
                onChange={(event) => {
                  setNotes(event.target.value);
                  try {
                    sessionStorage.setItem(notesKey, event.target.value);
                  } catch {
                    // Notes just aren't kept across a reload.
                  }
                }}
              />
            </div>
          </div>
        </div>
        <div tabIndex={0} role="region" aria-label={t("questions")} className={cn("bg-background min-w-0 overflow-y-auto p-4 sm:p-6 lg:block", view === "questions" ? "block" : "hidden")}>
          {section.questionGroups.map((group) => <QuestionGroupView key={group.id} group={group} imagePath={`${state.base}/groups/${group.id}/image`} answers={state.answers} current={state.current} onAnswer={state.answer} onFlag={state.flag} onFocus={state.setCurrent} />)}
        </div>
      </div>
    </Frame>
  );
}

const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
const countParagraphs = (text: string) => text.split(/\n\s*\n/).filter((block) => block.trim()).length;
export const WRITING_CRITERIA = ["task", "coherence", "lexical", "grammar"] as const;

function WritingRunner({ payload, onFinish, onExit, onClosed }: RunnerProps) {
  const t = useTranslations("practice");
  const labels = useTranslations("practice.writing");
  const { section, attempt } = payload;
  const base = `/attempts/${attempt.id}/sections/${section.id}`;
  const autosave = useAutosave<string>({
    storageKey: `ieltiva_writing_${attempt.id}_${section.id}`,
    save: async (changes) => {
      for (const [taskId, text] of Object.entries(changes)) await api.put(`${base}/writing/${taskId}`, { text });
    },
    onClosed,
  });
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(payload.writing.map((row) => [row.writingTaskId, row.text])));
  useEffect(() => {
    const unsaved = autosave.restored();
    if (Object.keys(unsaved).length) queueMicrotask(() => setText((all) => ({ ...all, ...unsaved })));
  }, [autosave.restored]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = async () => {
    await autosave.flush();
    onFinish();
  };
  const blank = section.writingTasks.filter((task) => !text[task.id]?.trim()).length;
  return (
    <Frame title={section.title} seconds={secondsLeft(payload.expiresAt, payload.serverTime)} status={autosave.status} savedAt={autosave.savedAt} onExpire={() => void finish()} finishLabel={t("submitWriting")} finishNote={blank ? labels("finishBlank", { count: blank }) : labels("finishNote")} onFinish={() => void finish()} onExit={() => void autosave.flush().then(onExit)}>
      <Tabs defaultValue={section.writingTasks[0]?.id} className="flex h-full flex-col gap-0">
        <div className="border-b px-3 py-2 sm:px-5">
          <TabsList className="w-full sm:w-fit">
            {section.writingTasks.map((task, index) => <TabsTrigger key={task.id} value={task.id}>{labels("taskName", { number: index + 1 })}</TabsTrigger>)}
          </TabsList>
        </div>
        {section.writingTasks.map((task, index) => {
          const value = text[task.id] ?? "";
          const words = countWords(value);
          const reached = words >= task.minWords;
          return (
            <TabsContent key={task.id} value={task.id} className="min-h-0 lg:grid lg:grid-cols-[2fr_3fr] lg:divide-x">
              <div tabIndex={0} role="region" aria-label={labels("taskInstructions")} className="overflow-y-auto p-4 sm:p-6">
                <p className="text-muted-foreground text-sm">{labels("guide", { minutes: task.suggestedMinutes, words: task.minWords })}</p>
                <h2 className="mt-3 text-lg leading-snug font-semibold whitespace-pre-wrap">{task.prompt}</h2>
                {task.hasImage && <div className="mt-4"><PrivateImage path={`${base}/tasks/${task.id}/image`} alt={labels("chartAlt")} /></div>}
                <div className="mt-6 border-t pt-4">
                  <h3 className="font-sans text-sm font-semibold tracking-normal">{labels("criteriaTitle")}</h3>
                  <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5 text-sm">
                    {WRITING_CRITERIA.map((key) => <li key={key}>{labels(`criteria.${key}`)}</li>)}
                  </ul>
                  <p className="text-muted-foreground mt-3 flex items-start gap-1.5 text-xs"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {labels("assessmentLater")}</p>
                </div>
              </div>
              <div className="flex min-h-[24rem] flex-col p-4 sm:p-6 lg:min-h-0">
                <Label htmlFor={`editor-${task.id}`} className="sr-only">{labels("answerLabel", { number: index + 1 })}</Label>
                <Textarea
                  id={`editor-${task.id}`}
                  spellCheck={false}
                  value={value}
                  placeholder={labels("placeholder")}
                  onChange={(event) => {
                    setText((all) => ({ ...all, [task.id]: event.target.value }));
                    autosave.queue(task.id, event.target.value);
                  }}
                  className="min-h-64 flex-1 resize-none rounded-b-none text-[1.0625rem] leading-[1.75] field-sizing-fixed"
                />
                <div className="bg-card rounded-b-md border border-t-0 px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
                    <p className="font-medium tabular-nums">{labels("wordCount", { words, minimum: task.minWords })}</p>
                    <p className="text-muted-foreground tabular-nums">{labels("paragraphCount", { count: countParagraphs(value) })}</p>
                    <p className={cn("inline-flex items-center gap-1 font-medium", reached ? "text-success" : "text-muted-foreground")}>
                      {reached && <CheckCircle2 className="size-4" aria-hidden />}
                      {reached ? labels("minimumReached") : labels("wordsToGo", { count: task.minWords - words })}
                    </p>
                  </div>
                  <Progress className="mt-2" value={Math.min(100, (words / task.minWords) * 100)} aria-label={labels("towardsMinimum")} />
                </div>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </Frame>
  );
}

function SpeakingRunner({ payload, onFinish, onExit }: RunnerProps) {
  const t = useTranslations("practice");
  const labels = useTranslations("practice.speaking");
  const { section, attempt } = payload;
  const base = `/attempts/${attempt.id}/sections/${section.id}`;
  const saved = useMemo(() => new Map(payload.speaking.map((row) => [row.speakingQuestionId, row])), [payload.speaking]);
  const [done, setDone] = useState(() => new Set(payload.speaking.filter((row) => row.hasRecording).map((row) => row.speakingQuestionId)));
  const parts = useMemo(() => {
    const groups = new Map<string, SpeakingQuestionView[]>();
    for (const question of section.speakingQuestions) groups.set(question.part, [...(groups.get(question.part) ?? []), question]);
    return [...groups.entries()];
  }, [section.speakingQuestions]);
  const remaining = section.speakingQuestions.length - done.size;
  return (
    <Frame title={section.title} seconds={secondsLeft(payload.expiresAt, payload.serverTime)} status={done.size ? "saved" : "idle"} savedAt={null} onExpire={onFinish} finishLabel={t("submitSpeaking")} finishNote={remaining ? labels("finishMissing", { count: remaining }) : labels("finishNote")} onFinish={onFinish} onExit={onExit}>
      <div tabIndex={0} role="region" aria-label={section.title} className="mx-auto h-full w-full max-w-3xl overflow-y-auto p-4 sm:p-6">
        <p className="text-muted-foreground mb-4 flex items-start gap-1.5 text-sm"><Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {labels("assessmentLater")}</p>
        <Tabs defaultValue={parts[0]?.[0]} className="gap-4">
          <TabsList className="w-full">{parts.map(([part]) => <TabsTrigger key={part} value={part}>{labels(`parts.${part}`)}</TabsTrigger>)}</TabsList>
          {parts.map(([part, questions]) => (
            <TabsContent key={part} value={part} className="space-y-6">
              {questions.map((question) => (
                <div key={question.id} className="space-y-3">
                  <h2 className="text-lg leading-snug font-semibold">{question.prompt}</h2>
                  {question.cueCard && <ul className="list-disc space-y-1 pl-5 leading-relaxed">{question.cueCard.map((point) => <li key={point}>{point}</li>)}</ul>}
                  <Recorder
                    basePath={`${base}/speaking/${question.id}/recording`}
                    prepSeconds={question.prepSeconds ?? 0}
                    maxSeconds={question.maxAnswerSeconds}
                    hasRecording={saved.get(question.id)?.hasRecording ?? false}
                    savedDuration={saved.get(question.id)?.durationSeconds ?? null}
                    onChange={(isSaved) => setDone((all) => { const next = new Set(all); if (isSaved) next.add(question.id); else next.delete(question.id); return next; })}
                  />
                </div>
              ))}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </Frame>
  );
}

type RunnerProps = { payload: SectionPayload; onFinish: () => void; onExit: () => void; onClosed: () => void };

const RUNNERS: Record<string, (props: RunnerProps) => ReactNode> = { LISTENING: ListeningRunner, READING: ReadingRunner, WRITING: WritingRunner, SPEAKING: SpeakingRunner };

const STATUS_ICONS: Record<string, typeof Circle> = { IN_PROGRESS: CircleDot, SUBMITTED: CheckCircle2, EXPIRED: Clock };

function Overview({ attempt, onOpen, onSubmit, busy }: { attempt: AttemptView; onOpen: (id: string) => void; onSubmit: () => void; busy: boolean }) {
  const t = useTranslations("practice");
  const labels = useLabels();
  const nextId = attempt.sections.find((section) => section.status === "IN_PROGRESS" || section.status === "NOT_STARTED")?.id;
  const open = attempt.sections.filter((section) => section.status === "IN_PROGRESS" || section.status === "NOT_STARTED").length;
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 p-4 outline-none sm:p-8">
      <Logo />
      <h1 className="font-display mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">{attempt.exam.title}</h1>
      <p className="text-muted-foreground mt-1">{attempt.mode === "PRACTICE" ? t("modes.practiceNote") : attempt.navigation === "SEQUENTIAL" ? t("modes.sequentialNote") : t("modes.timedNote")}</p>
      <ol className="bg-card shadow-soft mt-6 divide-y rounded-xl border">
        {attempt.sections.map((section) => {
          const Icon = STATUS_ICONS[section.status] ?? Circle;
          const finished = section.status === "SUBMITTED" || section.status === "EXPIRED" || section.status === "ABANDONED";
          const locked = attempt.navigation === "SEQUENTIAL" && !finished && section.id !== nextId;
          return (
            <li key={section.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <Icon className={cn("size-5 shrink-0", section.status === "SUBMITTED" ? "text-success" : section.status === "EXPIRED" ? "text-warning" : "text-muted-foreground")} aria-hidden />
              <div className="min-w-0 flex-1">
                <h2 className="font-sans font-medium tracking-normal break-words">{section.title}</h2>
                <p className="text-muted-foreground text-sm">{labels.skill(section.skill)} · {attempt.mode === "PRACTICE" ? t("noClock") : durationLabel(section.durationSeconds)} · {t(`status.${section.status}`)}</p>
              </div>
              {!finished && <Button disabled={locked} variant={section.id === nextId ? "default" : "outline"} onClick={() => onOpen(section.id)}>{section.status === "IN_PROGRESS" ? t("resumeSection") : t("startSection")}</Button>}
            </li>
          );
        })}
      </ol>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-between">
        <Button asChild variant="outline"><Link href="/practice">{t("saveAndLeave")}</Link></Button>
        <ConfirmButton size="default" variant="default" disabled={busy} label={t("submitExam")} title={t("submitExamTitle")} description={open ? t("submitExamOpen", { count: open }) : t("submitExamBody")} confirmLabel={t("submitExam")} onConfirm={onSubmit} />
      </div>
    </main>
  );
}

/** Runs one attempt. The server owns the clock and the state, so this reloads from it at every step. */
export function AttemptPlayer() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const t = useTranslations("practice");
  const router = useRouter();
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [payload, setPayload] = useState<SectionPayload | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const toResult = useCallback(() => router.replace(`/practice/attempts/${attemptId}`), [attemptId, router]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const view = await api.get<AttemptView>(`/attempts/${attemptId}`);
      setAttempt(view);
      setPayload(null);
      if (view.status !== "IN_PROGRESS") toResult();
    } catch (caught) {
      setError(caught);
    }
  }, [attemptId, toResult]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function open(sectionId: string) {
    setBusy(true);
    try {
      setPayload(await api.post<SectionPayload>(`/attempts/${attemptId}/sections/${sectionId}/start`));
    } catch (caught) {
      toast.error(caught instanceof ApiRequestError ? caught.message : t("somethingWrong"));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function finishSection(sectionId: string) {
    setBusy(true);
    try {
      const view = await api.post<AttemptView>(`/attempts/${attemptId}/sections/${sectionId}/submit`);
      setPayload(null);
      setAttempt(view);
      if (view.status !== "IN_PROGRESS") toResult();
    } catch (caught) {
      toast.error(caught instanceof ApiRequestError ? caught.message : t("somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  async function submitAll() {
    setBusy(true);
    try {
      await api.post(`/attempts/${attemptId}/submit`);
      toResult();
    } catch (caught) {
      toast.error(caught instanceof ApiRequestError ? caught.message : t("somethingWrong"));
      setBusy(false);
    }
  }

  if (error) return <main id="main" className="mx-auto w-full max-w-xl p-8"><ErrorBlock error={error} onRetry={() => void load()} /></main>;
  if (!attempt) return <main id="main" className="mx-auto w-full max-w-3xl space-y-4 p-8" role="status" aria-label={t("loading")}><Skeleton className="h-10 w-2/3" /><Skeleton className="h-48 w-full rounded-xl" /></main>;
  if (payload) {
    const Runner = RUNNERS[payload.section.skill];
    if (Runner) {
      const sectionId = payload.section.id;
      return (
        <Runner
          key={sectionId}
          payload={payload}
          onFinish={() => void finishSection(sectionId)}
          onExit={() => void load()}
          onClosed={() => {
            toast.info(t("sectionClosed"));
            void load();
          }}
        />
      );
    }
  }
  return <Overview attempt={attempt} onOpen={(id) => void open(id)} onSubmit={() => void submitAll()} busy={busy} />;
}
