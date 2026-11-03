import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListeningPreview, ReadingPreview, SpeakingPreview, WritingPreview } from "@/features/exam/sections";

export const metadata: Metadata = { title: "Exam interface preview", robots: { index: false, follow: false } };

const PREVIEWS = { listening: ListeningPreview, reading: ReadingPreview, writing: WritingPreview, speaking: SpeakingPreview };

/** Interface only. The practice engine, saved answers and marking arrive with Phase 4 and later. */
export default async function Page({ params }: { params: Promise<{ skill: string }> }) {
  const { skill } = await params;
  const Preview = PREVIEWS[skill as keyof typeof PREVIEWS];
  if (!Preview) notFound();
  return <Preview />;
}
