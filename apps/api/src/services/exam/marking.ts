import { choiceQuestionTypes, type AnswerResponse } from "@ieltiva/shared";

export type AnswerKey = { acceptedValue: string; caseSensitive: boolean; ignorePunctuation: boolean; maxWords: number | null };

export type MarkableQuestion = {
  type: string;
  marks: number;
  scoringMode: "ALL_OR_NOTHING" | "PER_ITEM";
  hasOptions: boolean;
  answers: AnswerKey[];
};

const EDGE_PUNCTUATION = /^[\s.,;:!?'"()[\]]+|[\s.,;:!?'"()[\]]+$/g;

/** Makes equivalent typed answers compare equal. Options come from each accepted answer, so authors can tighten a rule per question. */
export function normalizeAnswer(value: string, options: { caseSensitive?: boolean; ignorePunctuation?: boolean } = {}) {
  let result = value
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .trim()
    .replace(/\s+/g, " ");
  if (options.ignorePunctuation !== false) result = result.replace(EDGE_PUNCTUATION, "");
  return options.caseSensitive ? result : result.toLocaleLowerCase("en");
}

export const countWords = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
};

const isChoice = (question: MarkableQuestion) => question.hasOptions || (choiceQuestionTypes as readonly string[]).includes(question.type);

/** Marks one answer on the server, from the answer key alone. No AI is involved, and the client's view of correctness is never used. */
export function markQuestion(question: MarkableQuestion, response: AnswerResponse | null | undefined): { isCorrect: boolean; marksAwarded: number } {
  const wrong = { isCorrect: false, marksAwarded: 0 };
  if (!response) return wrong;

  if (isChoice(question)) {
    if (!("selected" in response)) return wrong;
    const selected = [...new Set(response.selected)];
    const accepted = new Set(question.answers.map((answer) => answer.acceptedValue));
    const hits = selected.filter((label) => accepted.has(label)).length;
    if (question.scoringMode === "PER_ITEM") {
      // Choosing more options than there are answers earns nothing, so selecting everything can't score.
      if (selected.length > accepted.size) return wrong;
      const marksAwarded = Math.min(hits, question.marks);
      return { isCorrect: hits === accepted.size, marksAwarded };
    }
    const isCorrect = hits === accepted.size && selected.length === accepted.size && accepted.size > 0;
    return isCorrect ? { isCorrect, marksAwarded: question.marks } : wrong;
  }

  if (!("text" in response)) return wrong;
  const isCorrect = question.answers.some((answer) => {
    if (answer.maxWords !== null && countWords(response.text) > answer.maxWords) return false;
    const given = normalizeAnswer(response.text, answer);
    return given !== "" && given === normalizeAnswer(answer.acceptedValue, answer);
  });
  return isCorrect ? { isCorrect, marksAwarded: question.marks } : wrong;
}

export const isAnswered = (response: AnswerResponse | null | undefined) => {
  if (!response) return false;
  return "text" in response ? response.text.trim() !== "" : response.selected.length > 0;
};

type AudioType = { contentType: string; extension: string; matches: (data: Buffer) => boolean };

const AUDIO_TYPES: AudioType[] = [
  { contentType: "audio/webm", extension: "webm", matches: (d) => d.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
  { contentType: "audio/ogg", extension: "ogg", matches: (d) => d.subarray(0, 4).toString("latin1") === "OggS" },
  { contentType: "audio/mp4", extension: "m4a", matches: (d) => d.subarray(4, 8).toString("latin1") === "ftyp" },
  { contentType: "audio/wav", extension: "wav", matches: (d) => d.subarray(0, 4).toString("latin1") === "RIFF" && d.subarray(8, 12).toString("latin1") === "WAVE" },
  { contentType: "audio/mpeg", extension: "mp3", matches: (d) => d.subarray(0, 3).toString("latin1") === "ID3" || (d[0] === 0xff && ((d[1] ?? 0) & 0xe0) === 0xe0) },
];

/** Checks the file's real bytes, so a renamed file can't pass as audio. */
export const detectAudioType = (data: Buffer) => AUDIO_TYPES.find((type) => type.matches(data)) ?? null;

export const audioContentType = (key: string) => AUDIO_TYPES.find((type) => key.endsWith(`.${type.extension}`))?.contentType ?? "application/octet-stream";
