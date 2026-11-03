"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { changeEmailSchema, changePasswordSchema, plannerTaskSchema, updateProfileSchema } from "@ieltiva/shared";
import { Award, Bell, BookCheck, Camera, CalendarCheck, CheckCheck, Clock, Flame, GraduationCap, History, Laptop, Lock, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import { StatCard } from "@/components/feedback/stat-card";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PersonalPlan } from "@/features/analytics/plan";
import { DataControls } from "@/features/privacy/data-controls";
import { PrivacyTab } from "@/features/ai/consent";
import { useAuth } from "@/features/auth/auth-provider";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatMinutes, formatPlainDate } from "../format";
import { applyFieldErrors, useApiAction, useApiPage, useApiQuery } from "../hooks";
import { useLabels } from "../labels";
import { ConfirmButton, Empty, FormDialog, InputField, PageHeader, Pagination, QueryBoundary, SelectBox } from "../ui";

type Profile = {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  hasPassword: boolean;
  linkedProviders: string[];
  roles: { code: string; name: string }[];
  firstName: string;
  lastName: string;
  hasPhoto: boolean;
  photoVersion: string | null;
  locale: string;
  timezone: string;
  examType: string | null;
  targetBand: number | null;
  examDate: string | null;
  weeklyStudyHours: number | null;
  dailyGoalMinutes: number | null;
  preferredSkills: string[];
  notificationPrefs: { learning: boolean; announcements: boolean };
};

type LearningStats = { stats: { completedActivities: number; loggedMinutes: number; streakDays: number; enrolledCourses: number } };

/** Milestones worked out from the student's real activity. They recognise effort and say nothing about ability or bands. */
function Achievements() {
  const t = useTranslations("app");
  const query = useApiQuery<LearningStats>("/dashboard/student");
  if (!query.data) return null;
  const { completedActivities, loggedMinutes, streakDays, enrolledCourses } = query.data.stats;
  const items = [
    { key: "first_course", icon: GraduationCap, earned: enrolledCourses >= 1 },
    { key: "first_lesson", icon: BookCheck, earned: completedActivities >= 1 },
    { key: "ten_lessons", icon: Award, earned: completedActivities >= 10 },
    { key: "five_hours", icon: Clock, earned: loggedMinutes >= 300 },
    { key: "week_streak", icon: Flame, earned: streakDays >= 7 },
  ];
  return (
    <section aria-labelledby="achievements-heading" className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t("completed_activities")} value={<AnimatedNumber value={completedActivities} />} icon={<BookCheck aria-hidden />} />
        <StatCard label={t("practice_time")} value={<AnimatedNumber value={loggedMinutes} format={formatMinutes} />} icon={<Clock aria-hidden />} />
        <StatCard label={t("current_streak")} value={<AnimatedNumber value={streakDays} format={(value) => (value === 1 ? t("1_day") : t("count_days", { count: value }))} />} icon={<Flame aria-hidden />} />
      </div>
      <Card className="shadow-soft">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle id="achievements-heading" className="font-display text-lg">{t("achievements")}</CardTitle>
          <Button asChild variant="ghost" size="sm"><Link href="/history"><History aria-hidden /> {t("learning_history")}</Link></Button>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {items.map(({ key, icon: Icon, earned }) => (
              <li key={key} className={cn("rounded-xl border p-4", earned ? "bg-accent/50" : "border-dashed")}>
                <span className={cn("flex size-10 items-center justify-center rounded-lg", earned ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                  {earned ? <Icon className="size-5" aria-hidden /> : <Lock className="size-4" aria-hidden />}
                </span>
                <p className="mt-3 text-sm font-semibold">{t(`achievement_${key}`)}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">{earned ? t("achievement_earned") : t(`achievement_${key}_hint`)}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

export function ProfilePage() {
  const t = useTranslations("app");
  const labels = useLabels();
  const { refreshUser } = useAuth();
  const query = useApiQuery<Profile>("/profile/me");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadPhoto = useApiAction((file: File) => api.put("/profile/photo", file), t("photo_updated"));
  const removePhoto = useApiAction(() => api.delete("/profile/photo"), t("photo_removed"));
  const form = useForm<{ firstName?: string | undefined; lastName?: string | undefined }>({ resolver: zodResolver(updateProfileSchema) });
  const save = useApiAction((values: { firstName?: string | undefined; lastName?: string | undefined }) => api.patch("/profile/me", values), t("profile_updated"));
  const { reset } = form;
  const loaded = query.data;

  useEffect(() => {
    if (loaded) reset({ firstName: loaded.firstName, lastName: loaded.lastName });
  }, [loaded, reset]);

  return (
    <>
      <PageHeader title={t("my_profile")} description={t("your_personal_details_and_ielts_preparation")} actions={<Button asChild variant="outline"><Link href="/settings">{t("settings")}</Link></Button>} />
      <QueryBoundary query={query}>
        {(profile) => (
          <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="shadow-soft gap-0 overflow-hidden pt-0">
              <div aria-hidden className="bg-brand-surface h-24" />
              <CardContent className="-mt-12 flex flex-col items-center gap-3 text-center">
                <Avatar className="ring-card size-24 ring-4">
                  {profile.hasPhoto && <AvatarImage src={`${api.url("/profile/photo")}?v=${profile.photoVersion}`} alt={t("your_profile_photo")} />}
                  <AvatarFallback className="text-2xl">{`${profile.firstName[0] ?? ""}${profile.lastName[0] ?? ""}`.toUpperCase() || "U"}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold break-words">{`${profile.firstName} ${profile.lastName}`}</h2>
                  <p className="text-muted-foreground text-sm break-all">{profile.email}</p>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {profile.roles.map((role) => <Badge key={role.code} variant="secondary">{labels.role(role.code)}</Badge>)}
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label={t("choose_a_profile_photo")}
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) uploadPhoto.mutate(file);
                    event.target.value = "";
                  }}
                />
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="outline" size="sm" disabled={uploadPhoto.isPending} onClick={() => fileInput.current?.click()}><Camera aria-hidden /> {t("change_photo")}</Button>
                  {profile.hasPhoto && <ConfirmButton label={t("remove")} title={t("remove_your_photo")} description={t("your_initials_will_show_instead")} onConfirm={() => removePhoto.mutate()} />}
                </div>
                <p className="text-muted-foreground text-xs">{t("png_jpeg_or_webp_up_to_2_mb")}</p>
              </CardContent>
            </Card>

            <div className="space-y-6 lg:col-span-2">
              <Card className="shadow-soft">
                <CardHeader><CardTitle className="font-display text-lg">{t("personal_details")}</CardTitle></CardHeader>
                <CardContent>
                  <form
                    noValidate
                    className="space-y-4"
                    onSubmit={form.handleSubmit((values) =>
                      save.mutate(values, {
                        onSuccess: () => void refreshUser(),
                        onError: (error) => applyFieldErrors(error, form.setError),
                      }),
                    )}
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <InputField label={t("first_name")} autoComplete="given-name" error={form.formState.errors.firstName?.message} {...form.register("firstName")} />
                      <InputField label={t("last_name")} autoComplete="family-name" error={form.formState.errors.lastName?.message} {...form.register("lastName")} />
                    </div>
                    <Button type="submit" disabled={save.isPending}>{t("save_changes")}</Button>
                  </form>
                </CardContent>
              </Card>
              <Card className="shadow-soft">
                <CardHeader><CardTitle className="font-display text-lg">{t("ielts_preparation")}</CardTitle></CardHeader>
                <CardContent>
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
                    <dt className="text-muted-foreground">{t("ielts_type")}</dt><dd>{labels.examType(profile.examType, t("not_chosen"))}</dd>
                    <dt className="text-muted-foreground">{t("target_band")}</dt><dd>{profile.targetBand?.toFixed(1) ?? "-"}</dd>
                    <dt className="text-muted-foreground">{t("exam_date")}</dt><dd>{formatPlainDate(profile.examDate)}</dd>
                    <dt className="text-muted-foreground">{t("focus_skills")}</dt><dd>{profile.preferredSkills.map((skill) => labels.skill(skill)).join(", ") || "-"}</dd>
                    <dt className="text-muted-foreground">{t("email_status")}</dt><dd>{profile.emailVerified ? t("verified") : t("not_verified")}</dd>
                    <dt className="text-muted-foreground">{t("member_since")}</dt><dd>{formatDate(profile.createdAt)}</dd>
                  </dl>
                  <Button asChild variant="outline" size="sm" className="mt-4"><Link href="/settings">{t("update_preferences")}</Link></Button>
                </CardContent>
              </Card>
            </div>
          </div>
          <Achievements />
          </div>
        )}
      </QueryBoundary>
    </>
  );
}

const preferencesForm = z.object({
  examType: z.string(),
  targetBand: z.string(),
  examDate: z.string(),
  weeklyStudyHours: z.string(),
  dailyGoalMinutes: z.string(),
  timezone: z.string(),
});
type PreferencesForm = z.infer<typeof preferencesForm>;

const numberOrNull = (value: string) => (value === "" ? null : Number(value));
const SKILLS = ["LISTENING", "READING", "WRITING", "SPEAKING"];

function PreferencesTab({ profile }: { profile: Profile }) {
  const t = useTranslations("app");
  const labels = useLabels();
  const [skills, setSkills] = useState(profile.preferredSkills);
  const form = useForm<PreferencesForm>({
    resolver: zodResolver(preferencesForm) as Resolver<PreferencesForm>,
    defaultValues: {
      examType: profile.examType ?? "",
      targetBand: profile.targetBand?.toFixed(1) ?? "",
      examDate: profile.examDate ?? "",
      weeklyStudyHours: profile.weeklyStudyHours?.toString() ?? "",
      dailyGoalMinutes: profile.dailyGoalMinutes?.toString() ?? "",
      timezone: profile.timezone,
    },
  });
  const save = useApiAction((body: object) => api.patch("/profile/preferences", body), t("preferences_saved"));
  const bands = Array.from({ length: 19 }, (_, index) => (index / 2).toFixed(1)).reverse();
  const zones = [...new Set([profile.timezone, "Asia/Dhaka", "UTC", ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [])])];

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit((values) =>
        save.mutate(
          {
            examType: values.examType || null,
            targetBand: numberOrNull(values.targetBand),
            examDate: values.examDate || null,
            weeklyStudyHours: numberOrNull(values.weeklyStudyHours),
            dailyGoalMinutes: numberOrNull(values.dailyGoalMinutes),
            timezone: values.timezone,
            preferredSkills: skills,
          },
          { onError: (error) => applyFieldErrors(error, form.setError) },
        ),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectBox label={t("ielts_type")} {...form.register("examType")} options={[{ value: "", label: t("not_chosen") }, { value: "ACADEMIC", label: labels.examType("ACADEMIC") }, { value: "GENERAL_TRAINING", label: labels.examType("GENERAL_TRAINING") }]} />
        <SelectBox label={t("target_band")} {...form.register("targetBand")} options={[{ value: "", label: t("not_set") }, ...bands.map((value) => ({ value, label: value }))]} />
        <InputField label={t("exam_date")} type="date" error={form.formState.errors.examDate?.message} {...form.register("examDate")} />
        <InputField label={t("study_hours_per_week")} type="number" min={0} max={100} error={form.formState.errors.weeklyStudyHours?.message} {...form.register("weeklyStudyHours")} />
        <InputField label={t("daily_goal_in_minutes")} type="number" min={0} max={1440} error={form.formState.errors.dailyGoalMinutes?.message} {...form.register("dailyGoalMinutes")} />
        <SelectBox label={t("timezone")} {...form.register("timezone")} options={zones.map((value) => ({ value, label: value }))} />
        <SelectBox label={t("language")} value="en" onChange={() => {}} options={[{ value: "en", label: t("english") }]} />
      </div>
      <p className="text-muted-foreground text-sm">{t("more_languages_will_be_added_later")}</p>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t("focus_skills")}</legend>
        <div className="flex flex-wrap gap-4">
          {SKILLS.map((skill) => (
            <div key={skill} className="flex items-center gap-2">
              <Checkbox
                id={`skill-${skill}`}
                checked={skills.includes(skill)}
                onCheckedChange={(checked) => setSkills((current) => (checked ? [...current, skill] : current.filter((value) => value !== skill)))}
              />
              <Label htmlFor={`skill-${skill}`}>{labels.skill(skill)}</Label>
            </div>
          ))}
        </div>
      </fieldset>
      <Button type="submit" disabled={save.isPending}>{t("save_preferences")}</Button>
    </form>
  );
}

function NotificationsTab({ profile }: { profile: Profile }) {
  const t = useTranslations("app");
  const save = useApiAction((notificationPrefs: Profile["notificationPrefs"]) => api.patch("/profile/preferences", { notificationPrefs }), t("notification_settings_saved"));
  const prefs = profile.notificationPrefs;
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-sm">{t("these_control_messages_inside_ieltiva_email_and_push_no")}</p>
      <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
        <div>
          <Label htmlFor="pref-learning">{t("learning_updates")}</Label>
          <p className="text-muted-foreground text-sm">{t("enrollments_new_courses_and_study_reminders")}</p>
        </div>
        <Switch id="pref-learning" checked={prefs.learning} disabled={save.isPending} onCheckedChange={(learning) => save.mutate({ ...prefs, learning })} />
      </div>
      <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
        <div>
          <Label htmlFor="pref-announcements">{t("announcements")}</Label>
          <p className="text-muted-foreground text-sm">{t("news_from_the_ieltiva_team")}</p>
        </div>
        <Switch id="pref-announcements" checked={prefs.announcements} disabled={save.isPending} onCheckedChange={(announcements) => save.mutate({ ...prefs, announcements })} />
      </div>
      <p className="text-muted-foreground text-sm">{t("security_messages_are_always_sent")}</p>
    </div>
  );
}

type Session = { id: string; userAgent: string | null; ipAddress: string | null; createdAt: string; lastSeenAt: string; current: boolean };

function describeDevice(agent: string | null, unknown: string) {
  if (!agent) return unknown;
  const browser = /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : null;
  const system = /Windows/.test(agent) ? "Windows" : /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Mac OS/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : null;
  return [browser, system].filter(Boolean).join(" on ") || unknown;
}

function SecurityTab({ profile }: { profile: Profile }) {
  const t = useTranslations("app");
  const { logout } = useAuth();
  const router = useRouter();
  const sessions = useApiQuery<Session[]>("/profile/sessions");
  const endOne = useApiAction((id: string) => api.delete<{ current: boolean }>(`/profile/sessions/${id}`), t("session_ended"));
  const endOthers = useApiAction(() => api.delete("/profile/sessions"), t("other_sessions_ended"));
  const passwordForm = useForm({ resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" } });
  const changePassword = useApiAction((values: object) => api.post("/profile/password", values, { skipRefresh: true }), t("password_changed_other_devices_were_signed_out"));
  const emailForm = useForm({ resolver: zodResolver(changeEmailSchema), defaultValues: { newEmail: "", currentPassword: "" } });
  const changeEmail = useApiAction((values: object) => api.post("/profile/email", values, { skipRefresh: true }), t("if_that_address_can_be_used_we_ll_send_it_a_confirmatio"));

  return (
    <div className="space-y-8">
      <section aria-labelledby="sessions-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="sessions-heading" className="font-display font-semibold">{t("signed_in_devices")}</h2>
          <ConfirmButton label={t("sign_out_other_devices")} title={t("sign_out_all_other_devices")} description={t("this_device_stays_signed_in")} onConfirm={() => endOthers.mutate()} />
        </div>
        <QueryBoundary query={sessions}>
          {(rows) => (
            <ul className="divide-y rounded-xl border">
              {rows.map((session) => (
                <li key={session.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 gap-3">
                    <Laptop className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">{describeDevice(session.userAgent, t("unknown_device"))} {session.current && <Badge variant="secondary">{t("this_device")}</Badge>}</p>
                      <p className="text-muted-foreground">{t("signed_in_date", { date: formatDateTime(session.createdAt) })}</p>
                      <p className="text-muted-foreground">{t("last_active_date", { date: formatDateTime(session.lastSeenAt) })}{session.ipAddress ? ` · ${session.ipAddress}` : ""}</p>
                    </div>
                  </div>
                  <ConfirmButton
                    label={t("sign_out")}
                    title={t("sign_out_this_device")}
                    description={session.current ? t("you_ll_return_to_the_sign_in_page") : t("that_device_will_need_to_sign_in_again")}
                    onConfirm={() =>
                      endOne.mutate(session.id, {
                        onSuccess: (result) => {
                          if (result.current) void logout().catch(() => {}).finally(() => router.replace("/login"));
                        },
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </section>

      {profile.hasPassword ? (
        <div className="grid gap-8 lg:grid-cols-2">
          <section aria-labelledby="password-heading">
            <h2 id="password-heading" className="font-display mb-3 font-semibold">{t("change_password")}</h2>
            <form
              noValidate
              className="space-y-3"
              onSubmit={passwordForm.handleSubmit((values) =>
                changePassword.mutate(values, {
                  onSuccess: () => passwordForm.reset(),
                  onError: (error) => applyFieldErrors(error, passwordForm.setError),
                }),
              )}
            >
              <InputField label={t("current_password")} type="password" autoComplete="current-password" error={passwordForm.formState.errors.currentPassword?.message} {...passwordForm.register("currentPassword")} />
              <InputField label={t("new_password")} type="password" autoComplete="new-password" hint={t("at_least_10_characters_with_lowercase_uppercase_and_a_n")} error={passwordForm.formState.errors.newPassword?.message} {...passwordForm.register("newPassword")} />
              <InputField label={t("confirm_new_password")} type="password" autoComplete="new-password" error={passwordForm.formState.errors.confirmPassword?.message} {...passwordForm.register("confirmPassword")} />
              <Button type="submit" disabled={changePassword.isPending}>{t("change_password")}</Button>
            </form>
          </section>
          <section aria-labelledby="email-heading">
            <h2 id="email-heading" className="font-display mb-3 font-semibold">{t("change_email")}</h2>
            <p className="text-muted-foreground mb-3 text-sm">{t("your_email_changes_only_after_you_confirm_the_link_sent", { email: profile.email })}</p>
            <form
              noValidate
              className="space-y-3"
              onSubmit={emailForm.handleSubmit((values) =>
                changeEmail.mutate(values, {
                  onSuccess: () => emailForm.reset(),
                  onError: (error) => applyFieldErrors(error, emailForm.setError),
                }),
              )}
            >
              <InputField label={t("new_email")} type="email" autoComplete="email" error={emailForm.formState.errors.newEmail?.message} {...emailForm.register("newEmail")} />
              <InputField label={t("your_password")} type="password" autoComplete="current-password" error={emailForm.formState.errors.currentPassword?.message} {...emailForm.register("currentPassword")} />
              <Button type="submit" disabled={changeEmail.isPending}>{t("send_confirmation_link")}</Button>
            </form>
          </section>
        </div>
      ) : (
        <p className="text-sm">
          {t("you_sign_in_with_google_so_you_don_t_have_a_password_ye")}{" "}
          <Link href="/forgot-password" className="text-primary font-medium underline underline-offset-4">{t("set_a_password")}</Link>
        </p>
      )}
    </div>
  );
}

export function SettingsPage() {
  const t = useTranslations("app");
  const privacy = useTranslations("ai.privacy");
  const query = useApiQuery<Profile>("/profile/me");
  return (
    <>
      <PageHeader title={t("settings")} description={t("your_preferences_notifications_and_account_security")} />
      <QueryBoundary query={query}>
        {(profile) => (
          <Tabs defaultValue="preferences">
            <TabsList className="w-full sm:w-fit">
              <TabsTrigger value="preferences">{t("preferences")}</TabsTrigger>
              <TabsTrigger value="notifications">{t("notifications")}</TabsTrigger>
              <TabsTrigger value="security">{t("security")}</TabsTrigger>
              <TabsTrigger value="privacy">{privacy("tab")}</TabsTrigger>
            </TabsList>
            <Card className="shadow-soft mt-4">
              <CardContent>
                <TabsContent value="preferences"><PreferencesTab profile={profile} /></TabsContent>
                <TabsContent value="notifications"><NotificationsTab profile={profile} /></TabsContent>
                <TabsContent value="security"><SecurityTab profile={profile} /></TabsContent>
                <TabsContent value="privacy"><PrivacyTab /><DataControls /></TabsContent>
              </CardContent>
            </Card>
          </Tabs>
        )}
      </QueryBoundary>
    </>
  );
}

type Task = { id: string; title: string; skill: string | null; scheduledDate: string; estimatedMinutes: number | null; completedAt: string | null };

export function PlannerPage() {
  const t = useTranslations("app");
  const labels = useLabels();
  const [open, setOpen] = useState(false);
  const query = useApiQuery<Task[]>("/planner/tasks");
  const create = useApiAction((body: object) => api.post("/planner/tasks", body), t("task_added"));
  const toggle = useApiAction(({ id, completed }: { id: string; completed: boolean }) => api.patch(`/planner/tasks/${id}`, { completed }));
  const remove = useApiAction((id: string) => api.delete(`/planner/tasks/${id}`), t("task_removed"));
  const today = new Date().toISOString().slice(0, 10);
  const form = useForm({
    resolver: zodResolver(plannerTaskSchema),
    defaultValues: { title: "", scheduledDate: today, skill: null as "LISTENING" | "READING" | "WRITING" | "SPEAKING" | null },
  });

  return (
    <>
      <PageHeader
        title={t("study_planner")}
        description={t("planner_intro")}
        actions={
          <FormDialog open={open} onOpenChange={setOpen} title={t("add_a_study_task")} trigger={<Button><CalendarCheck aria-hidden /> {t("add_task")}</Button>}>
            <form
              noValidate
              className="space-y-4"
              onSubmit={form.handleSubmit((values) =>
                create.mutate(values, {
                  onSuccess: () => {
                    form.reset({ title: "", scheduledDate: today, skill: null });
                    setOpen(false);
                  },
                  onError: (error) => applyFieldErrors(error, form.setError),
                }),
              )}
            >
              <InputField label={t("task")} error={form.formState.errors.title?.message} {...form.register("title")} />
              <InputField label={t("date")} type="date" error={form.formState.errors.scheduledDate?.message} {...form.register("scheduledDate")} />
              <SelectBox
                label={t("skill")}
                {...form.register("skill", { setValueAs: (value) => value || null })}
                options={[{ value: "", label: t("no_specific_skill") }, ...SKILLS.map((value) => ({ value, label: labels.skill(value) }))]}
              />
              <Button type="submit" disabled={create.isPending}>{t("add_task")}</Button>
            </form>
          </FormDialog>
        }
      />
      <PersonalPlan />
      <QueryBoundary query={query}>
        {(tasks) =>
          tasks.length === 0 ? (
            <Empty icon={<CalendarCheck aria-hidden />} title={t("no_study_tasks_yet")} description={t("add_your_first_task_to_start_planning")} />
          ) : (
            <ul className="bg-card divide-y rounded-xl border">
              {tasks.map((task) => {
                const overdue = !task.completedAt && task.scheduledDate.slice(0, 10) < today;
                return (
                  <li key={task.id} className="flex items-center gap-3 p-3">
                    <Checkbox
                      id={`task-${task.id}`}
                      checked={Boolean(task.completedAt)}
                      onCheckedChange={(checked) => toggle.mutate({ id: task.id, completed: checked === true })}
                    />
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={`task-${task.id}`} className={task.completedAt ? "text-muted-foreground line-through" : undefined}>{task.title}</Label>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {formatPlainDate(task.scheduledDate)}{task.skill ? ` · ${labels.skill(task.skill)}` : ""}{overdue ? ` · ${t("overdue")}` : ""}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" aria-label={t("remove_task", { task: task.title })} onClick={() => remove.mutate(task.id)}><Trash2 aria-hidden /></Button>
                  </li>
                );
              })}
            </ul>
          )
        }
      </QueryBoundary>
    </>
  );
}

type HistoryRow = { id: string; eventType: string; minutes: number | null; occurredAt: string; course: { id: string; title: string } | null; resource: { id: string; title: string } | null };

export function HistoryPage() {
  const t = useTranslations("app");
  const labels = useLabels();
  const [page, setPage] = useState(1);
  const query = useApiPage<HistoryRow>("/history/me", { page, pageSize: 20 });
  return (
    <>
      <PageHeader title={t("learning_history")} description={t("everything_you_ve_done_from_your_stored_activity")} />
      <QueryBoundary query={query}>
        {({ items, meta }) =>
          items.length === 0 ? (
            <Empty icon={<History aria-hidden />} title={t("no_activity_yet")} description={t("your_lessons_and_completed_work_appear_here")} action={<Button asChild><Link href="/courses">{t("browse_courses")}</Link></Button>} />
          ) : (
            <>
              <ol className="bg-card divide-y rounded-xl border">
                {items.map((row) => (
                  <li key={row.id} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="font-medium">{labels.event(row.eventType)}</p>
                      <p className="text-muted-foreground break-words">
                        {row.course && <Link href={`/courses/${row.course.id}`} className="underline-offset-4 hover:underline">{row.course.title}</Link>}
                        {row.resource && ` · ${row.resource.title}`}
                        {row.minutes ? ` · ${row.minutes}m` : ""}
                      </p>
                    </div>
                    <time className="text-muted-foreground shrink-0">{formatDateTime(row.occurredAt)}</time>
                  </li>
                ))}
              </ol>
              <Pagination meta={meta} onPage={setPage} />
            </>
          )
        }
      </QueryBoundary>
    </>
  );
}

type NotificationRow = { id: string; type: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };

export function NotificationCenter() {
  const t = useTranslations("app");
  const labels = useLabels();
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");
  const [unread, setUnread] = useState("");
  const query = useApiPage<NotificationRow>("/notifications", { page, pageSize: 15, type, unread });
  const read = useApiAction((id: string) => api.patch(`/notifications/${id}/read`));
  const readAll = useApiAction(() => api.patch("/notifications/read-all"), t("all_marked_as_read"));
  const dismiss = useApiAction((id: string) => api.delete(`/notifications/${id}`), t("notification_dismissed"));
  return (
    <>
      <PageHeader
        title={t("notifications")}
        description={t("messages_inside_ieltiva")}
        actions={<Button variant="outline" disabled={readAll.isPending} onClick={() => readAll.mutate()}><CheckCheck aria-hidden /> {t("mark_all_as_read")}</Button>}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <SelectBox hideLabel label={t("filter_by_type")} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} options={[{ value: "", label: t("all_types") }, ...["LEARNING", "SECURITY", "ANNOUNCEMENT", "SYSTEM"].map((value) => ({ value, label: labels.notificationType(value) }))]} />
        <SelectBox hideLabel label={t("filter_by_read_status")} value={unread} onChange={(e) => { setUnread(e.target.value); setPage(1); }} options={[{ value: "", label: t("read_and_unread") }, { value: "true", label: t("unread_only") }, { value: "false", label: t("read_only") }]} />
      </div>
      <QueryBoundary query={query}>
        {({ items, meta }) =>
          items.length === 0 ? (
            <Empty icon={<Bell aria-hidden />} title={t("no_notifications")} description={t("you_re_all_caught_up")} />
          ) : (
            <>
              <ul className="bg-card divide-y rounded-xl border">
                {items.map((row) => (
                  <li key={row.id} className={row.readAt ? "flex flex-col gap-3 p-4 sm:flex-row sm:items-start" : "bg-accent/40 flex flex-col gap-3 p-4 sm:flex-row sm:items-start"}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-medium break-words">{row.title}</h2>
                        <Badge variant="outline">{labels.notificationType(row.type)}</Badge>
                        {!row.readAt && <Badge>{t("new")}</Badge>}
                      </div>
                      <p className="text-muted-foreground mt-1 text-sm break-words">{row.body}</p>
                      <p className="text-muted-foreground mt-1 text-xs">{formatDateTime(row.createdAt)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {row.link && <Button asChild variant="outline" size="sm"><Link href={row.link} onClick={() => { if (!row.readAt) read.mutate(row.id); }}>{t("open")}</Link></Button>}
                      {!row.readAt && <Button variant="ghost" size="sm" onClick={() => read.mutate(row.id)}>{t("mark_as_read")}</Button>}
                      <Button variant="ghost" size="icon" aria-label={t("dismiss_title", { title: row.title })} onClick={() => { dismiss.mutate(row.id); }}><Trash2 aria-hidden /></Button>
                    </div>
                  </li>
                ))}
              </ul>
              <Pagination meta={meta} onPage={setPage} />
            </>
          )
        }
      </QueryBoundary>
    </>
  );
}

