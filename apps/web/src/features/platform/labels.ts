"use client";

import { useTranslations } from "next-intl";

/** Display text for stored values, in one place. */
export function useLabels() {
  const t = useTranslations("app");
  const map = (values: Record<string, string>) => (value: string | null | undefined, fallback = "-") => (value ? (values[value] ?? value) : fallback);
  return {
    t,
    examType: map({ ACADEMIC: t("academic"), GENERAL_TRAINING: t("general_training") }),
    skill: map({ LISTENING: t("listening"), READING: t("reading"), WRITING: t("writing"), SPEAKING: t("speaking") }),
    difficulty: map({ BEGINNER: t("beginner"), INTERMEDIATE: t("intermediate"), ADVANCED: t("advanced") }),
    resourceType: map({
      ARTICLE: t("text_lesson"),
      DOCUMENT: t("pdf_resource"),
      VIDEO: t("video_reference"),
      EXTERNAL_LINK: t("external_link"),
      VOCABULARY: t("vocabulary"),
      GRAMMAR: t("grammar_lesson"),
      PRACTICE_GUIDANCE: t("practice_guidance"),
    }),
    status: map({
      DRAFT: t("draft"),
      IN_REVIEW: t("in_review"),
      PUBLISHED: t("published"),
      ARCHIVED: t("archived"),
      ACTIVE: t("active"),
      COMPLETED: t("completed"),
      CANCELED: t("canceled"),
      SUSPENDED: t("suspended"),
      DELETION_PENDING: t("deletion_pending"),
      DELETED: t("deleted"),
    }),
    role: map({ STUDENT: t("student"), INSTRUCTOR: t("instructor"), MARKER: t("marker"), EDITOR: t("editor"), ADMIN: t("administrator"), SUPER_ADMIN: t("super_administrator") }),
    event: map({
      ENROLLED: t("enrolled_in_a_course"),
      ENROLLMENT_CANCELED: t("left_a_course"),
      RESOURCE_OPENED: t("opened_a_resource"),
      RESOURCE_COMPLETED: t("completed_a_resource"),
      COURSE_COMPLETED: t("completed_a_course"),
    }),
    notificationType: map({ SYSTEM: t("system"), LEARNING: t("learning"), SECURITY: t("security"), ANNOUNCEMENT: t("announcement") }),
    action: map({ PUBLISHED: t("published"), ARCHIVED: t("archived"), RESTORED_TO_DRAFT: t("returned_to_draft"), CONTENT_UPDATED: t("content_updated"), SUBMITTED_FOR_REVIEW: t("submitted_for_review") }),
  };
}
