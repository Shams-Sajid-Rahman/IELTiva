"use client";

import { questionTypes, writingTaskTypes } from "@ieltiva/shared";
import { AlertTriangle, CheckCircle2, Eye, FileAudio, Plus, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/features/auth/auth-provider";
import { QuestionGroupView, type AnswerEntry } from "@/features/exam/question-renderer";
import type { GroupView, Stimulus } from "@/features/exam/types";
import { durationLabel } from "@/features/exam/types";
import { api, ApiRequestError } from "@/lib/api-client";
import { formatDateTime } from "../format";
import { useApiAction, useApiPage, useApiQuery, useDebounced } from "../hooks";
import { useLabels } from "../labels";
import { ConfirmButton, Empty, FormDialog, InputField, PageHeader, Pagination, QueryBoundary, SearchField, SelectBox, StatusBadge, TextAreaField } from "../ui";

type ExamRow = { id: string; title: string; examType: string | null; isMock: boolean; isPremium: boolean; versions: { id: string; versionNumber: number; status: string; publishedAt: string | null }[] };
type ExamFull = Omit<ExamRow, "versions"> & { versions: { id: string; versionNumber: number; status: string; publishedAt: string | null; createdAt: string; _count: { attempts: number } }[] };
type AnswerKey = { acceptedValue: string; maxWords: number | null };
type QuestionFull = { id: string; number: number; prompt: string | null; explanation: string | null; marks: number; scoringMode: string; options: { id: string; label: string; body: string }[]; answers: AnswerKey[] };
type GroupFull = { id: string; position: number; type: string; instructions: string | null; stimulus: Stimulus | null; imageStorageKey: string | null; questions: QuestionFull[] };
type SectionFull = {
  id: string;
  position: number;
  skill: string;
  title: string;
  instructions: string | null;
  durationSeconds: number;
  settings: { maxAudioPlays?: number | null };
  readingPassages: { id: string; title: string; wordCount: number }[];
  listeningAudios: { id: string; position: number; durationSeconds: number; transcript: string | null }[];
  questionGroups: GroupFull[];
  writingTasks: { id: string; taskType: string; prompt: string; minWords: number; suggestedMinutes: number }[];
  speakingQuestions: { id: string; part: string; prompt: string; prepSeconds: number | null; maxAnswerSeconds: number }[];
};
type VersionFull = { id: string; examId: string; versionNumber: number; status: string; publishedAt: string | null; provenance: string; sourceNote: string | null; settings: { navigation?: string; reviewPolicy?: string }; sections: SectionFull[] };

const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof ApiRequestError) {
    const details = error.fieldErrors.map((item) => item.message).join(" ");
    return details || error.message;
  }
  return fallback;
};

/** A small form in a dialog. Shows the server's message when something is refused. */
function SimpleForm({ trigger, title, onSubmit, children }: { trigger: ReactNode; title: string; onSubmit: (data: FormData) => Promise<unknown>; children: ReactNode }) {
  const t = useTranslations("examAdmin");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(new FormData(form));
      form.reset();
      setOpen(false);
    } catch (caught) {
      setError(errorMessage(caught, t("failed")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormDialog open={open} onOpenChange={setOpen} title={title} trigger={trigger}>
      <form className="space-y-4" onSubmit={(event) => void handle(event)}>
        {children}
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        <Button type="submit" disabled={busy}>{t("save")}</Button>
      </form>
    </FormDialog>
  );
}

const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

export function ExamsAdminPage() {
  const t = useTranslations("examAdmin");
  const labels = useLabels();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const query = useApiPage<ExamRow>("/admin/exams", { page, pageSize: 20, search: debounced });
  const create = useApiAction((body: object) => api.post<{ id: string }>("/admin/exams", body));
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("intro")}
        actions={
          <SimpleForm
            title={t("newExam")}
            trigger={<Button><Plus aria-hidden /> {t("newExam")}</Button>}
            onSubmit={async (data) => {
              const exam = await create.mutateAsync({ title: text(data, "title"), examType: text(data, "examType") || null, isMock: data.get("isMock") === "on", isPremium: data.get("isPremium") === "on" });
              router.push(`/admin/exams/${exam.id}`);
            }}
          >
            <InputField name="title" label={t("examTitle")} required />
            <SelectBox name="examType" label={t("examType")} options={[{ value: "", label: t("bothTypes") }, { value: "ACADEMIC", label: labels.examType("ACADEMIC") }, { value: "GENERAL_TRAINING", label: labels.examType("GENERAL_TRAINING") }]} />
            <div className="flex items-center gap-2"><Checkbox id="isMock" name="isMock" /><Label htmlFor="isMock">{t("isMock")}</Label></div>
            <div className="flex items-center gap-2"><Checkbox id="isPremium" name="isPremium" /><Label htmlFor="isPremium">{t("isPremium")}</Label></div>
          </SimpleForm>
        }
      />
      <div className="mb-4"><SearchField label={t("search")} value={search} onChange={(value) => { setSearch(value); setPage(1); }} /></div>
      <QueryBoundary query={query}>
        {({ items, meta }) =>
          items.length === 0 ? <Empty title={t("none")} description={t("noneBody")} /> : (
            <>
              <ul className="bg-card shadow-soft divide-y rounded-xl border">
                {items.map((exam) => {
                  const latest = exam.versions[0];
                  return (
                    <li key={exam.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <Link href={`/admin/exams/${exam.id}`} className="font-medium break-words underline-offset-4 hover:underline">{exam.title}</Link>
                        <p className="text-muted-foreground text-sm">{exam.examType ? labels.examType(exam.examType) : t("bothTypes")}{exam.isMock ? ` · ${t("mock")}` : ""}{latest ? ` · ${t("versionNumber", { number: latest.versionNumber })}` : ""}</p>
                      </div>
                      {latest && <StatusBadge status={latest.status} />}
                    </li>
                  );
                })}
              </ul>
              <Pagination meta={meta} onPage={setPage} />
            </>
          )
        }
      </QueryBoundary>
    </>
  );
}

function SectionAddForm({ versionId }: { versionId: string }) {
  const t = useTranslations("examAdmin");
  const labels = useLabels();
  const add = useApiAction((body: object) => api.post(`/admin/exam-versions/${versionId}/sections`, body), t("saved"));
  return (
    <SimpleForm
      title={t("addSection")}
      trigger={<Button><Plus aria-hidden /> {t("addSection")}</Button>}
      onSubmit={(data) => {
        const plays = text(data, "maxAudioPlays");
        return add.mutateAsync({ skill: text(data, "skill"), title: text(data, "title"), instructions: text(data, "instructions") || null, durationSeconds: Number(text(data, "minutes")) * 60, ...(plays ? { settings: { maxAudioPlays: plays === "0" ? null : Number(plays) } } : {}) });
      }}
    >
      <SelectBox name="skill" label={t("skill")} options={["LISTENING", "READING", "WRITING", "SPEAKING"].map((value) => ({ value, label: labels.skill(value) }))} />
      <InputField name="title" label={t("sectionTitle")} required />
      <TextAreaField name="instructions" label={t("instructions")} rows={2} />
      <InputField name="minutes" type="number" min={1} max={240} label={t("minutes")} required />
      <InputField name="maxAudioPlays" type="number" min={0} max={20} label={t("audioPlays")} hint={t("audioPlaysHint")} />
    </SimpleForm>
  );
}

function QuestionAddForm({ group, nextNumber }: { group: GroupFull; nextNumber: number }) {
  const t = useTranslations("examAdmin");
  const add = useApiAction((body: object) => api.post(`/admin/question-groups/${group.id}/questions`, body), t("saved"));
  const fixed = group.type === "TRUE_FALSE_NOT_GIVEN" || group.type === "YES_NO_NOT_GIVEN";
  return (
    <SimpleForm
      title={t("addQuestion")}
      trigger={<Button variant="outline" size="sm"><Plus aria-hidden /> {t("addQuestion")}</Button>}
      onSubmit={(data) => {
        const options = lines(text(data, "options")).map((line) => {
          const [label, ...rest] = line.split("|");
          return { label: label!.trim(), body: (rest.join("|") || label!).trim() };
        });
        const maxWords = text(data, "maxWords");
        return add.mutateAsync({
          number: Number(text(data, "number")),
          prompt: text(data, "prompt") || null,
          explanation: text(data, "explanation") || null,
          marks: Number(text(data, "marks") || 1),
          scoringMode: data.get("perItem") === "on" ? "PER_ITEM" : "ALL_OR_NOTHING",
          ...(options.length ? { options } : {}),
          answers: lines(text(data, "answers")).map((acceptedValue) => ({ acceptedValue, ...(maxWords ? { maxWords: Number(maxWords) } : {}) })),
        });
      }}
    >
      <InputField name="number" type="number" min={1} max={200} defaultValue={nextNumber} label={t("number")} required />
      <TextAreaField name="prompt" label={t("prompt")} rows={2} />
      {!fixed && <TextAreaField name="options" label={t("options")} rows={4} placeholder={t("optionsHint")} />}
      <TextAreaField name="answers" label={t("answers")} rows={3} required placeholder={fixed ? t("answersFixedHint") : t("answersHint")} />
      <InputField name="maxWords" type="number" min={1} max={20} label={t("maxWords")} />
      <InputField name="marks" type="number" min={1} max={20} defaultValue={1} label={t("marks")} />
      {group.type === "MULTIPLE_CHOICE_MULTI" && <div className="flex items-center gap-2"><Checkbox id={`per-item-${group.id}`} name="perItem" /><Label htmlFor={`per-item-${group.id}`}>{t("perItem")}</Label></div>}
      <TextAreaField name="explanation" label={t("explanation")} rows={2} />
    </SimpleForm>
  );
}

function GroupEditor({ group, editable, nextNumber }: { group: GroupFull; editable: boolean; nextNumber: number }) {
  const t = useTranslations("examAdmin");
  const remove = useApiAction(() => api.delete(`/admin/question-groups/${group.id}`), t("removed"));
  const removeQuestion = useApiAction((id: string) => api.delete(`/admin/questions/${id}`), t("removed"));
  const uploadImage = useApiAction((file: File) => api.put(`/admin/question-groups/${group.id}/image`, file), t("saved"));
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{t(`types.${group.type}`)}</p>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <QuestionAddForm group={group} nextNumber={nextNumber} />
            <label className="border-input hover:bg-accent inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium focus-within:ring-[3px] pointer-coarse:h-10">
              <Upload className="size-4" aria-hidden /> {t("image")}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadImage.mutate(file); event.target.value = ""; }} />
            </label>
            <ConfirmButton label={<Trash2 aria-hidden />} title={t("removeGroup")} description={t("removeBody")} destructive onConfirm={() => remove.mutate()} />
          </div>
        )}
      </div>
      {group.instructions && <p className="text-muted-foreground mt-1 text-sm">{group.instructions}</p>}
      {group.imageStorageKey && <p className="text-muted-foreground mt-1 text-xs">{t("hasImage")}</p>}
      <ul className="mt-2 divide-y">
        {group.questions.map((question) => (
          <li key={question.id} className="flex items-start gap-2 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="break-words"><span className="font-semibold tabular-nums">{question.number}.</span> {question.prompt}</p>
              <p className="text-muted-foreground break-words">{t("keyLabel")} {question.answers.map((answer) => answer.acceptedValue).join(" / ")}{question.marks > 1 ? ` · ${t("marksCount", { count: question.marks })}` : ""}</p>
            </div>
            {editable && <Button variant="ghost" size="icon" aria-label={t("removeQuestion", { number: question.number })} onClick={() => removeQuestion.mutate(question.id)}><Trash2 aria-hidden /></Button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionEditor({ section, editable, examType }: { section: SectionFull; editable: boolean; examType: string | null }) {
  const t = useTranslations("examAdmin");
  const labels = useLabels();
  const route = `/admin/exam-sections/${section.id}`;
  const remove = useApiAction(() => api.delete(route), t("removed"));
  const addPassage = useApiAction((body: object) => api.post(`${route}/passages`, body), t("saved"));
  const removePassage = useApiAction((id: string) => api.delete(`/admin/passages/${id}`), t("removed"));
  const addGroup = useApiAction((body: object) => api.post(`${route}/groups`, body), t("saved"));
  const addTask = useApiAction((body: object) => api.post(`${route}/writing-tasks`, body), t("saved"));
  const removeTask = useApiAction((id: string) => api.delete(`/admin/writing-tasks/${id}`), t("removed"));
  const addSpeaking = useApiAction((body: object) => api.post(`${route}/speaking-questions`, body), t("saved"));
  const removeSpeaking = useApiAction((id: string) => api.delete(`/admin/speaking-questions/${id}`), t("removed"));
  const uploadAudio = useApiAction(({ file, seconds }: { file: File; seconds: number }) => api.put(`${route}/audio?durationSeconds=${seconds}`, file), t("saved"));
  const saveTranscript = useApiAction(({ id, transcript }: { id: string; transcript: string }) => api.patch(`/admin/audio/${id}`, { transcript }), t("saved"));
  const removeAudio = useApiAction((id: string) => api.delete(`/admin/audio/${id}`), t("removed"));
  const objective = section.skill === "LISTENING" || section.skill === "READING";
  const nextNumber = Math.max(0, ...section.questionGroups.flatMap((group) => group.questions.map((question) => question.number))) + 1;
  const taskTypes = writingTaskTypes.filter((type) => !(examType === "ACADEMIC" && type === "GENERAL_TASK_1") && !(examType === "GENERAL_TRAINING" && type === "ACADEMIC_TASK_1"));

  return (
    <Card className="shadow-soft">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="font-display text-lg break-words">{section.title}</CardTitle>
          <p className="text-muted-foreground text-sm">{labels.skill(section.skill)} · {durationLabel(section.durationSeconds)}</p>
        </div>
        {editable && <ConfirmButton label={t("removeSection")} title={t("removeSection")} description={t("removeBody")} destructive onConfirm={() => remove.mutate()} />}
      </CardHeader>
      <CardContent className="space-y-4">
        {section.skill === "READING" && (
          <div className="space-y-2">
            <h3 className="font-sans text-sm font-semibold tracking-normal">{t("passages")}</h3>
            <ul className="space-y-1 text-sm">
              {section.readingPassages.map((passage) => (
                <li key={passage.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 break-words">{passage.title} <span className="text-muted-foreground">· {t("wordsCount", { count: passage.wordCount })}</span></span>
                  {editable && <Button variant="ghost" size="icon" aria-label={t("removePassage", { title: passage.title })} onClick={() => removePassage.mutate(passage.id)}><Trash2 aria-hidden /></Button>}
                </li>
              ))}
            </ul>
            {editable && (
              <SimpleForm title={t("addPassage")} trigger={<Button variant="outline" size="sm"><Plus aria-hidden /> {t("addPassage")}</Button>} onSubmit={(data) => addPassage.mutateAsync({ title: text(data, "title"), body: text(data, "body") })}>
                <InputField name="title" label={t("passageTitle")} required />
                <TextAreaField name="body" label={t("passageBody")} rows={10} required />
              </SimpleForm>
            )}
          </div>
        )}

        {section.skill === "LISTENING" && (
          <div className="space-y-2">
            <h3 className="font-sans text-sm font-semibold tracking-normal">{t("audio")}</h3>
            <ul className="space-y-3 text-sm">
              {section.listeningAudios.map((audio) => (
                <li key={audio.id} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <FileAudio className="text-muted-foreground size-4" aria-hidden />
                    <span className="min-w-0 flex-1">{t("audioItem", { number: audio.position, length: durationLabel(audio.durationSeconds) })}</span>
                    {editable && <Button variant="ghost" size="icon" aria-label={t("removeAudio", { number: audio.position })} onClick={() => removeAudio.mutate(audio.id)}><Trash2 aria-hidden /></Button>}
                  </div>
                  {editable ? (
                    <form className="mt-2 space-y-2" onSubmit={(event) => { event.preventDefault(); saveTranscript.mutate({ id: audio.id, transcript: String(new FormData(event.currentTarget).get("transcript") ?? "") }); }}>
                      <TextAreaField name="transcript" label={t("transcript")} rows={2} defaultValue={audio.transcript ?? ""} />
                      <Button type="submit" variant="outline" size="sm">{t("saveTranscript")}</Button>
                    </form>
                  ) : audio.transcript && <p className="text-muted-foreground mt-1">{audio.transcript}</p>}
                </li>
              ))}
            </ul>
            {editable && (
              <SimpleForm
                title={t("uploadAudio")}
                trigger={<Button variant="outline" size="sm"><Upload aria-hidden /> {t("uploadAudio")}</Button>}
                onSubmit={async (data) => {
                  const file = data.get("file");
                  if (!(file instanceof File) || !file.size) throw new Error(t("chooseFile"));
                  await uploadAudio.mutateAsync({ file, seconds: Number(text(data, "seconds")) });
                }}
              >
                <div className="space-y-2"><Label htmlFor={`audio-${section.id}`}>{t("audioFile")}</Label><input id={`audio-${section.id}`} name="file" type="file" accept="audio/*" required className="block w-full text-sm" /></div>
                <InputField name="seconds" type="number" min={1} max={14400} label={t("audioSeconds")} required />
                <p className="text-muted-foreground text-sm">{t("rightsNote")}</p>
              </SimpleForm>
            )}
          </div>
        )}

        {objective && (
          <div className="space-y-2">
            <h3 className="font-sans text-sm font-semibold tracking-normal">{t("questionGroups")}</h3>
            {section.questionGroups.map((group) => <GroupEditor key={group.id} group={group} editable={editable} nextNumber={nextNumber} />)}
            {editable && (
              <SimpleForm
                title={t("addGroup")}
                trigger={<Button variant="outline" size="sm"><Plus aria-hidden /> {t("addGroup")}</Button>}
                onSubmit={(data) => {
                  const stimulusText = text(data, "stimulus");
                  return addGroup.mutateAsync({ type: text(data, "type"), instructions: text(data, "instructions") || null, ...(stimulusText ? { stimulus: { text: stimulusText } } : {}) });
                }}
              >
                <SelectBox name="type" label={t("questionType")} options={questionTypes.map((value) => ({ value, label: t(`types.${value}`) }))} />
                <TextAreaField name="instructions" label={t("instructions")} rows={2} />
                <TextAreaField name="stimulus" label={t("stimulus")} rows={4} />
              </SimpleForm>
            )}
          </div>
        )}

        {section.skill === "WRITING" && (
          <div className="space-y-2">
            <ul className="space-y-2 text-sm">
              {section.writingTasks.map((task) => (
                <li key={task.id} className="flex items-start gap-2 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{t(`taskTypes.${task.taskType}`)} · {t("wordsCount", { count: task.minWords })} · {task.suggestedMinutes} min</p>
                    <p className="text-muted-foreground break-words">{task.prompt}</p>
                  </div>
                  {editable && <Button variant="ghost" size="icon" aria-label={t("removeTask")} onClick={() => removeTask.mutate(task.id)}><Trash2 aria-hidden /></Button>}
                </li>
              ))}
            </ul>
            {editable && (
              <SimpleForm title={t("addTask")} trigger={<Button variant="outline" size="sm"><Plus aria-hidden /> {t("addTask")}</Button>} onSubmit={(data) => addTask.mutateAsync({ taskType: text(data, "taskType"), prompt: text(data, "prompt"), minWords: Number(text(data, "minWords")), suggestedMinutes: Number(text(data, "minutes")) })}>
                <SelectBox name="taskType" label={t("taskType")} options={taskTypes.map((value) => ({ value, label: t(`taskTypes.${value}`) }))} />
                <TextAreaField name="prompt" label={t("prompt")} rows={4} required />
                <InputField name="minWords" type="number" min={1} max={1000} label={t("minWords")} required />
                <InputField name="minutes" type="number" min={1} max={240} label={t("suggestedMinutes")} required />
              </SimpleForm>
            )}
          </div>
        )}

        {section.skill === "SPEAKING" && (
          <div className="space-y-2">
            <ul className="space-y-2 text-sm">
              {section.speakingQuestions.map((question) => (
                <li key={question.id} className="flex items-start gap-2 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{t(`parts.${question.part}`)} · {t("answerTime", { seconds: question.maxAnswerSeconds })}{question.prepSeconds ? ` · ${t("prepTime", { seconds: question.prepSeconds })}` : ""}</p>
                    <p className="text-muted-foreground break-words">{question.prompt}</p>
                  </div>
                  {editable && <Button variant="ghost" size="icon" aria-label={t("removeSpeaking")} onClick={() => removeSpeaking.mutate(question.id)}><Trash2 aria-hidden /></Button>}
                </li>
              ))}
            </ul>
            {editable && (
              <SimpleForm
                title={t("addSpeaking")}
                trigger={<Button variant="outline" size="sm"><Plus aria-hidden /> {t("addSpeaking")}</Button>}
                onSubmit={(data) => {
                  const cue = lines(text(data, "cue"));
                  const prep = text(data, "prep");
                  return addSpeaking.mutateAsync({ part: text(data, "part"), prompt: text(data, "prompt"), maxAnswerSeconds: Number(text(data, "max")), ...(prep ? { prepSeconds: Number(prep) } : {}), ...(cue.length ? { cueCard: cue } : {}) });
                }}
              >
                <SelectBox name="part" label={t("part")} options={["PART_1", "PART_2", "PART_3"].map((value) => ({ value, label: t(`parts.${value}`) }))} />
                <TextAreaField name="prompt" label={t("prompt")} rows={2} required />
                <TextAreaField name="cue" label={t("cueCard")} rows={3} />
                <InputField name="prep" type="number" min={0} max={600} label={t("prepSeconds")} />
                <InputField name="max" type="number" min={5} max={600} label={t("maxSeconds")} required />
              </SimpleForm>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Shows Reading and Listening questions as a student would see them. Answers typed here go nowhere. */
function VersionPreview({ version }: { version: VersionFull }) {
  const t = useTranslations("examAdmin");
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, AnswerEntry>>({});
  return (
    <FormDialog open={open} onOpenChange={setOpen} title={t("previewTitle")} description={t("previewBody")} trigger={<Button variant="outline"><Eye aria-hidden /> {t("preview")}</Button>}>
      <div className="space-y-6">
        {version.sections.map((section) => (
          <div key={section.id}>
            <h3 className="font-semibold">{section.title}</h3>
            {section.questionGroups.map((group) => {
              const view: GroupView = { id: group.id, position: group.position, type: group.type, instructions: group.instructions, stimulus: group.stimulus, hasImage: false, questions: group.questions.map(({ id, number, prompt, marks, options }) => ({ id, number, prompt, marks, options })) };
              return <QuestionGroupView key={group.id} group={view} answers={answers} onAnswer={(id, response) => setAnswers((all) => ({ ...all, [id]: { response, isFlagged: false } }))} />;
            })}
            {section.writingTasks.map((task) => <p key={task.id} className="mt-2 text-sm whitespace-pre-wrap">{task.prompt}</p>)}
            {section.speakingQuestions.map((question) => <p key={question.id} className="mt-2 text-sm">{question.prompt}</p>)}
          </div>
        ))}
      </div>
    </FormDialog>
  );
}

function ValidationPanel({ versionId }: { versionId: string }) {
  const t = useTranslations("examAdmin");
  const query = useApiQuery<{ errors: string[]; warnings: string[] }>(`/admin/exam-versions/${versionId}/validation`);
  if (!query.data) return null;
  const { errors, warnings } = query.data;
  return (
    <div className="space-y-2 text-sm" aria-live="polite">
      {errors.length === 0 && <p className="text-success flex items-center gap-1.5 font-medium"><CheckCircle2 className="size-4" aria-hidden /> {t("readyToPublish")}</p>}
      {errors.map((message) => <p key={message} className="text-destructive flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {message}</p>)}
      {warnings.map((message) => <p key={message} className="text-warning flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {message}</p>)}
    </div>
  );
}

function VersionEditor({ versionId, examType }: { versionId: string; examType: string | null }) {
  const t = useTranslations("examAdmin");
  const { hasPermission } = useAuth();
  const query = useApiQuery<VersionFull>(`/admin/exam-versions/${versionId}`);
  const publish = useApiAction(() => api.post<{ warnings: string[] }>(`/admin/exam-versions/${versionId}/publish`));
  const archive = useApiAction(() => api.post(`/admin/exam-versions/${versionId}/archive`), t("archived"));
  const update = useApiAction((body: object) => api.patch(`/admin/exam-versions/${versionId}`, body), t("saved"));
  return (
    <QueryBoundary query={query}>
      {(version) => {
        const editable = !version.publishedAt;
        return (
          <div className="space-y-4">
            <Card className="shadow-soft">
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-lg font-semibold">{t("versionNumber", { number: version.versionNumber })}</h2>
                  <StatusBadge status={version.status} />
                  {!editable && <Badge variant="outline">{t("locked")}</Badge>}
                </div>
                {editable ? (
                  <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); update.mutate({ provenance: text(data, "provenance"), sourceNote: text(data, "sourceNote") || null, settings: { ...(text(data, "navigation") ? { navigation: text(data, "navigation") } : {}), reviewPolicy: text(data, "reviewPolicy") } }); }}>
                    <SelectBox name="provenance" label={t("provenance")} defaultValue={version.provenance} options={["ORIGINAL", "LICENSED", "AI_ASSISTED_REVIEWED"].map((value) => ({ value, label: t(`provenanceTypes.${value}`) }))} />
                    <InputField name="sourceNote" label={t("sourceNote")} defaultValue={version.sourceNote ?? ""} />
                    <SelectBox name="navigation" label={t("navigation")} defaultValue={version.settings.navigation ?? ""} options={[{ value: "", label: t("navigationDefault") }, { value: "FREE", label: t("navigationFree") }, { value: "SEQUENTIAL", label: t("navigationSequential") }]} />
                    <SelectBox name="reviewPolicy" label={t("reviewPolicy")} defaultValue={version.settings.reviewPolicy ?? "AFTER_SUBMISSION"} options={[{ value: "AFTER_SUBMISSION", label: t("reviewAfter") }, { value: "NEVER", label: t("reviewNever") }]} />
                    <div className="sm:col-span-2"><Button type="submit" variant="outline" disabled={update.isPending}>{t("saveSettings")}</Button></div>
                  </form>
                ) : (
                  <p className="text-muted-foreground text-sm">{t("lockedBody")}</p>
                )}
                {editable && <p className="text-muted-foreground text-sm">{t("rightsNote")}</p>}
                <ValidationPanel versionId={versionId} />
                <div className="flex flex-wrap gap-2">
                  <VersionPreview version={version} />
                  {editable && <SectionAddForm versionId={versionId} />}
                  {editable && hasPermission("content.publish") && (
                    <ConfirmButton
                      size="default"
                      variant="default"
                      label={t("publish")}
                      title={t("publishTitle")}
                      description={t("publishBody")}
                      confirmLabel={t("publish")}
                      onConfirm={() =>
                        publish.mutate(undefined, {
                          onSuccess: (result) => {
                            toast.success(t("published"));
                            result.warnings.forEach((warning) => toast.warning(warning));
                          },
                        })
                      }
                    />
                  )}
                  {version.status === "PUBLISHED" && hasPermission("content.publish") && <ConfirmButton size="default" label={t("archive")} title={t("archiveTitle")} description={t("archiveBody")} onConfirm={() => archive.mutate()} />}
                </div>
              </CardContent>
            </Card>
            {version.sections.map((section) => <SectionEditor key={section.id} section={section} editable={editable} examType={examType} />)}
          </div>
        );
      }}
    </QueryBoundary>
  );
}

export function ExamEditorPage() {
  const t = useTranslations("examAdmin");
  const { id } = useParams<{ id: string }>();
  const query = useApiQuery<ExamFull>(`/admin/exams/${id}`);
  const [selected, setSelected] = useState<string | null>(null);
  const createVersion = useApiAction(() => api.post<{ id: string }>(`/admin/exams/${id}/versions`), t("versionCreated"));
  return (
    <QueryBoundary query={query}>
      {(exam) => {
        const current = selected ?? exam.versions[0]?.id;
        const latest = exam.versions[0];
        return (
          <>
            <PageHeader
              title={exam.title}
              description={t("editorIntro")}
              actions={latest?.publishedAt && <Button disabled={createVersion.isPending} onClick={() => createVersion.mutate(undefined, { onSuccess: (version) => setSelected(version.id) })}><Plus aria-hidden /> {t("newVersion")}</Button>}
            />
            <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t("versions")}>
              {exam.versions.map((version) => (
                <Button key={version.id} size="sm" variant={version.id === current ? "default" : "outline"} aria-pressed={version.id === current} onClick={() => setSelected(version.id)}>
                  {t("versionNumber", { number: version.versionNumber })} · {t(`versionStatus.${version.status}`)}
                </Button>
              ))}
            </div>
            {latest?.publishedAt && <p className="text-muted-foreground mb-4 text-sm">{t("publishedOn", { date: formatDateTime(latest.publishedAt), count: latest._count.attempts })}</p>}
            {current ? <VersionEditor key={current} versionId={current} examType={exam.examType} /> : <Empty title={t("none")} />}
          </>
        );
      }}
    </QueryBoundary>
  );
}
