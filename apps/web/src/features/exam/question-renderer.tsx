"use client";

import type { AnswerResponse } from "@ieltiva/shared";
import { ArrowDown, Flag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { GroupView, QuestionView, Stimulus } from "./types";

export type AnswerEntry = { response: AnswerResponse | null; isFlagged: boolean };

const RADIO_TYPES = ["MULTIPLE_CHOICE_SINGLE", "TRUE_FALSE_NOT_GIVEN", "YES_NO_NOT_GIVEN"];

export const hasAnswer = (entry: AnswerEntry | undefined) => {
  const response = entry?.response;
  if (!response) return false;
  return "text" in response ? response.text.trim() !== "" : response.selected.length > 0;
};

/** The one control for each question type, so a new type only needs a new branch here. */
function AnswerControl({ type, question, value, onChange, disabled }: { type: string; question: QuestionView; value: AnswerResponse | null; onChange: (value: AnswerResponse) => void; disabled?: boolean | undefined }) {
  const t = useTranslations("practice");
  const labelId = `q-${question.id}-label`;
  const selected = value && "selected" in value ? value.selected : [];

  if (type === "MULTIPLE_CHOICE_MULTI") {
    return (
      <div role="group" aria-labelledby={labelId} className="mt-3 space-y-1">
        <p className="text-muted-foreground text-xs">{t("chooseUpTo", { count: question.marks > 1 ? question.marks : question.options.length })}</p>
        {question.options.map((option) => {
          const id = `q-${question.id}-${option.id}`;
          return (
            <div key={option.id} className="hover:bg-muted flex items-start gap-3 rounded-lg px-2 py-2 pointer-coarse:py-3">
              <Checkbox id={id} disabled={disabled} checked={selected.includes(option.label)} onCheckedChange={(checked) => onChange({ selected: checked ? [...selected, option.label] : selected.filter((label) => label !== option.label) })} />
              <Label htmlFor={id} className="flex-1 cursor-pointer leading-snug font-normal"><span className="font-semibold">{option.label}</span> {option.body !== option.label && option.body}</Label>
            </div>
          );
        })}
      </div>
    );
  }

  if (RADIO_TYPES.includes(type)) {
    return (
      <RadioGroup aria-labelledby={labelId} disabled={disabled} value={selected[0] ?? ""} onValueChange={(label) => onChange({ selected: [label] })} className="mt-3 gap-1">
        {question.options.map((option) => {
          const id = `q-${question.id}-${option.id}`;
          return (
            <div key={option.id} className="hover:bg-muted flex items-start gap-3 rounded-lg px-2 py-2 pointer-coarse:py-3">
              <RadioGroupItem id={id} value={option.label} className="mt-0.5" />
              <Label htmlFor={id} className="flex-1 cursor-pointer leading-snug font-normal">
                {option.body === option.label ? option.label : <><span className="font-semibold">{option.label}</span> {option.body}</>}
              </Label>
            </div>
          );
        })}
      </RadioGroup>
    );
  }

  // Matching and labelling share a long list of options, so a compact list works on every screen.
  if (question.options.length) {
    return (
      <select
        aria-labelledby={labelId}
        disabled={disabled}
        value={selected[0] ?? ""}
        onChange={(event) => onChange({ selected: event.target.value ? [event.target.value] : [] })}
        className="border-input bg-card focus-visible:ring-ring/50 mt-2 h-9 w-full max-w-md rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] pointer-coarse:h-11"
      >
        <option value="">{t("chooseAnswer")}</option>
        {question.options.map((option) => <option key={option.id} value={option.label}>{option.body === option.label ? option.label : `${option.label}. ${option.body}`}</option>)}
      </select>
    );
  }

  return (
    <Input
      aria-labelledby={labelId}
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      disabled={disabled}
      className="mt-2 max-w-sm"
      value={value && "text" in value ? value.text : ""}
      onChange={(event) => onChange({ text: event.target.value })}
    />
  );
}

/** Reads a private image through the API after an access check. */
export function PrivateImage({ path, alt }: { path: string; alt: string }) {
  const t = useTranslations("practice");
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let created: string | null = null;
    api.getBlob(path).then(
      (blob) => {
        if (!active) return;
        created = URL.createObjectURL(blob);
        setSource(created);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [path]);
  if (failed) return <p role="alert" className="text-destructive text-sm">{t("imageFailed")}</p>;
  // A private blob address, which Next's image optimiser can't fetch.
  // eslint-disable-next-line @next/next/no-img-element
  return source ? <img src={source} alt={alt} decoding="async" className="max-h-96 max-w-full rounded-lg border" /> : <div className="bg-muted h-40 w-full max-w-md animate-pulse rounded-lg" />;
}

function StimulusView({ stimulus }: { stimulus: Stimulus }) {
  return (
    <div className="mb-3 space-y-3 text-sm">
      {stimulus.text && <p className="bg-muted rounded-lg p-3 leading-relaxed whitespace-pre-wrap">{stimulus.text}</p>}
      {stimulus.rows && (
        <div tabIndex={0} role="region" aria-label="Table" className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left">
            {stimulus.headers && <thead><tr>{stimulus.headers.map((heading) => <th key={heading} scope="col" className="border-b px-3 py-2 font-semibold">{heading}</th>)}</tr></thead>}
            <tbody>{stimulus.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className="border-b px-3 py-2">{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {stimulus.steps && (
        <ol className="space-y-1">
          {stimulus.steps.map((step, index) => (
            <li key={index}>
              <p className="bg-muted rounded-lg px-3 py-2">{step}</p>
              {index < stimulus.steps!.length - 1 && <ArrowDown aria-hidden className="text-muted-foreground mx-auto my-1 size-4" />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function QuestionGroupView({
  group,
  imagePath,
  answers,
  current,
  onAnswer,
  onFlag,
  onFocus,
}: {
  group: GroupView;
  imagePath?: string | undefined;
  answers: Record<string, AnswerEntry>;
  current?: string | undefined;
  onAnswer: (questionId: string, response: AnswerResponse) => void;
  onFlag?: ((questionId: string) => void) | undefined;
  onFocus?: ((questionId: string) => void) | undefined;
}) {
  const t = useTranslations("practice");
  const first = group.questions[0]?.number;
  const last = group.questions.at(-1)?.number;
  return (
    <section aria-label={t("questionRange", { first: first ?? 0, last: last ?? 0 })} className="mb-6">
      <h3 className="font-display font-semibold">{first === last ? t("questionOne", { number: first ?? 0 }) : t("questionRange", { first: first ?? 0, last: last ?? 0 })}</h3>
      {group.instructions && <p className="text-muted-foreground mt-1 mb-3 text-sm leading-relaxed whitespace-pre-wrap">{group.instructions}</p>}
      {group.stimulus && <StimulusView stimulus={group.stimulus} />}
      {group.hasImage && imagePath && <div className="mb-3"><PrivateImage path={imagePath} alt={t("diagramAlt")} /></div>}
      <ol className="space-y-3">
        {group.questions.map((question) => {
          const entry = answers[question.id];
          const flagged = entry?.isFlagged ?? false;
          return (
            <li key={question.id} id={`q-${question.id}`} onFocusCapture={() => onFocus?.(question.id)} className={cn("bg-card scroll-mt-32 rounded-xl border p-4", current === question.id && "border-primary")}>
              <div className="flex items-start gap-3">
                <span aria-hidden className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold tabular-nums">{question.number}</span>
                <div className="min-w-0 flex-1">
                  <p id={`q-${question.id}-label`} className="text-sm leading-relaxed font-medium">
                    <span className="sr-only">{t("questionOne", { number: question.number })}. </span>
                    {question.prompt ?? t("answerHere")}
                  </p>
                  <AnswerControl type={group.type} question={question} value={entry?.response ?? null} onChange={(response) => onAnswer(question.id, response)} />
                </div>
                {onFlag && (
                  <Button variant="ghost" size="icon" aria-pressed={flagged} aria-label={t("flagQuestion", { number: question.number })} onClick={() => onFlag(question.id)} className={flagged ? "text-warning" : "text-muted-foreground"}>
                    <Flag className={flagged ? "fill-warning" : undefined} aria-hidden />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
