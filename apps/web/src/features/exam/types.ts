import type { AnswerResponse } from "@ieltiva/shared";

export type QuestionView = { id: string; number: number; prompt: string | null; marks: number; options: { id: string; label: string; body: string }[] };
export type Stimulus = { text?: string; headers?: string[]; rows?: string[][]; steps?: string[] };
export type GroupView = { id: string; position: number; type: string; instructions: string | null; stimulus: Stimulus | null; hasImage: boolean; questions: QuestionView[] };
export type WritingTaskView = { id: string; position: number; taskType: string; prompt: string; minWords: number; suggestedMinutes: number; hasImage: boolean };
export type SpeakingQuestionView = { id: string; part: "PART_1" | "PART_2" | "PART_3"; position: number; prompt: string; cueCard: string[] | null; prepSeconds: number | null; maxAnswerSeconds: number };
export type AudioView = { id: string; position: number; durationSeconds: number; playsUsed: number };

export type AttemptSection = { id: string; position: number; skill: string; title: string; durationSeconds: number; status: string; startedAt: string | null; expiresAt: string | null; lastSavedAt: string | null };
export type AttemptView = {
  id: string;
  mode: string;
  status: string;
  startedAt: string;
  expiresAt: string | null;
  submittedAt: string | null;
  serverTime: string;
  navigation: "FREE" | "SEQUENTIAL";
  exam: { id: string; title: string; examType: string | null; isMock: boolean };
  sections: AttemptSection[];
};

export type SectionPayload = {
  attempt: AttemptView;
  status: string;
  expiresAt: string | null;
  lastSavedAt: string | null;
  serverTime: string;
  responses: { questionId: string; response: AnswerResponse | null; isFlagged: boolean }[];
  writing: { writingTaskId: string; text: string; wordCount: number; lastSavedAt: string | null; timeSpentSeconds: number }[];
  speaking: { speakingQuestionId: string; durationSeconds: number | null; hasRecording: boolean }[];
  section: {
    id: string;
    skill: string;
    title: string;
    instructions: string | null;
    durationSeconds: number;
    readingPassages: { id: string; position: number; title: string; body: string }[];
    listeningAudios: AudioView[];
    questionGroups: GroupView[];
    writingTasks: WritingTaskView[];
    speakingQuestions: SpeakingQuestionView[];
    maxAudioPlays: number | null;
    allowAudioSeek: boolean;
  };
};

export type ExamListItem = { id: string; title: string; examType: string | null; isMock: boolean; isPremium: boolean; skills: string[]; durationSeconds: number; questionCount: number; activeAttemptId: string | null };
export type ExamDetail = {
  id: string;
  title: string;
  examType: string | null;
  isMock: boolean;
  isPremium: boolean;
  activeAttemptId: string | null;
  navigation: "FREE" | "SEQUENTIAL";
  sections: { id: string; position: number; skill: string; title: string; instructions: string | null; durationSeconds: number; questionCount: number }[];
};
export type AttemptRow = { id: string; mode: string; status: string; startedAt: string; submittedAt: string | null; rawScore: number | null; maxScore: number | null; exam: { id: string; title: string; examType: string | null; isMock: boolean } };

export type ReviewItem = {
  id: string;
  number: number;
  prompt: string | null;
  marks: number;
  explanation: string | null;
  type: string;
  options: { label: string; body: string }[];
  acceptedAnswers: string[];
  response: AnswerResponse | null;
  isCorrect: boolean;
  marksAwarded: number;
};
export type ResultSection = {
  id: string;
  title: string;
  skill: string;
  status: string;
  rawScore: number | null;
  maxScore: number | null;
  timeSpentSeconds: number;
  review?: ReviewItem[];
  transcripts?: string[];
  writing?: { id: string; text: string; wordCount: number; submittedAt: string | null; writingTask: { taskType: string; prompt: string; minWords: number } }[];
  speaking?: { id: string; durationSeconds: number | null; submittedAt: string | null; hasRecording: boolean; speakingQuestion: { id: string; part: string; prompt: string } }[];
};
export type AttemptResult = { attempt: AttemptView; rawScore: number | null; maxScore: number | null; reviewAllowed: boolean; sections: ResultSection[] };

export type WritingRow = { id: string; text: string; wordCount: number; lastSavedAt: string | null; submittedAt: string | null; attemptId: string; sectionId: string; examTitle: string; writingTask: { taskType: string; prompt: string; minWords: number } };
export type SpeakingRow = { id: string; durationSeconds: number | null; submittedAt: string | null; createdAt: string; attemptId: string; sectionId: string; speakingQuestionId: string; examTitle: string; speakingQuestion: { part: string; prompt: string } };

export const durationLabel = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : minutes > 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
};
