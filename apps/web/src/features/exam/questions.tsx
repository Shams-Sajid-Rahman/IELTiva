"use client";

import { Flag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export type Question = { id: number; prompt: string; options?: string[] };

/** Answers live only in this component's memory. They're never sent anywhere or stored. */
export function useQuestions(questions: Question[]) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [flags, setFlags] = useState<number[]>([]);
  const [current, setCurrent] = useState(questions[0]?.id ?? 1);

  const jump = useCallback((id: number) => {
    setCurrent(id);
    document.getElementById(`question-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  return {
    numbers: questions.map((question) => question.id),
    current,
    setCurrent,
    jump,
    answers,
    answer: (id: number, value: string) => setAnswers((all) => ({ ...all, [id]: value })),
    isAnswered: (id: number) => Boolean(answers[id]?.trim()),
    isFlagged: (id: number) => flags.includes(id),
    toggleFlag: (id: number) => setFlags((all) => (all.includes(id) ? all.filter((value) => value !== id) : [...all, id])),
    answeredCount: questions.filter((question) => answers[question.id]?.trim()).length,
  };
}

export function QuestionList({ questions, state }: { questions: Question[]; state: ReturnType<typeof useQuestions> }) {
  const t = useTranslations("exam");
  return (
    <ol className="space-y-3">
      {questions.map((question) => {
        const flagged = state.isFlagged(question.id);
        const labelId = `question-${question.id}-label`;
        return (
          <li
            key={question.id}
            id={`question-${question.id}`}
            onFocusCapture={() => state.setCurrent(question.id)}
            className={cn("bg-card scroll-mt-32 rounded-xl border p-4 transition-colors", state.current === question.id && "border-primary")}
          >
            <div className="flex items-start gap-3">
              <span aria-hidden className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold tabular-nums">{question.id}</span>
              <div className="min-w-0 flex-1">
                {question.options ? (
                  <>
                    <p id={labelId} className="text-sm leading-relaxed font-medium">{question.prompt}</p>
                    <RadioGroup aria-labelledby={labelId} value={state.answers[question.id] ?? ""} onValueChange={(value) => state.answer(question.id, value)} className="mt-3 gap-1">
                      {question.options.map((option, index) => {
                        const id = `q${question.id}-${index}`;
                        return (
                          <div key={option} className="hover:bg-muted flex items-center gap-3 rounded-lg px-2 py-2 transition-colors pointer-coarse:py-3">
                            <RadioGroupItem id={id} value={option} />
                            <Label htmlFor={id} className="flex-1 cursor-pointer leading-snug font-normal">{option}</Label>
                          </div>
                        );
                      })}
                    </RadioGroup>
                  </>
                ) : (
                  <>
                    <Label htmlFor={`q${question.id}-input`} className="leading-relaxed">{question.prompt}</Label>
                    <Input id={`q${question.id}-input`} autoComplete="off" spellCheck={false} className="mt-2 sm:max-w-xs" value={state.answers[question.id] ?? ""} onChange={(event) => state.answer(question.id, event.target.value)} />
                  </>
                )}
              </div>
              <Button variant="ghost" size="icon" aria-pressed={flagged} aria-label={t("flagQuestion", { number: question.id })} onClick={() => state.toggleFlag(question.id)} className={flagged ? "text-warning" : "text-muted-foreground"}>
                <Flag className={flagged ? "fill-warning" : undefined} aria-hidden />
              </Button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
