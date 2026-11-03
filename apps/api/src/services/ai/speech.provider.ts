import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { AudioError, convertToWav } from "../audio/audio.service.js";
import { AiError } from "./provider.js";

export type WordTiming = { word: string; offsetMs: number; durationMs: number; accuracyScore: number | null };
export type Transcription = {
  transcript: string;
  words: WordTiming[];
  /** Azure's own measures, from the audio. They're experimental and never feed a band. */
  pronunciation: { accuracyScore: number | null; fluencyScore: number | null; prosodyScore: number | null; pronunciationScore: number | null } | null;
  durationMs: number;
};

export interface SpeechProvider {
  readonly name: string;
  transcribe(audio: Buffer): Promise<Transcription>;
}

/** Browsers record compressed audio, and the recogniser needs 16 kHz mono WAV. */
async function toWav(audio: Buffer) {
  try {
    return await convertToWav(audio);
  } catch (error) {
    if (error instanceof AudioError && error.kind === "UNAVAILABLE") throw new AiError("NOT_CONFIGURED", "The audio converter isn't available.", false);
    throw new AiError("INVALID_OUTPUT", "This recording couldn't be read.", false);
  }
}

type AzureWord = { Word: string; Offset: number; Duration: number; PronunciationAssessment?: { AccuracyScore?: number } };
type AzureSegment = { DisplayText?: string; NBest?: { Display?: string; Words?: AzureWord[]; PronunciationAssessment?: { AccuracyScore?: number; FluencyScore?: number; ProsodyScore?: number; PronScore?: number } }[] };

const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

export class AzureSpeechProvider implements SpeechProvider {
  readonly name = "azure";

  constructor(
    private readonly key: string,
    private readonly region: string,
    private readonly language: string,
  ) {}

  async transcribe(audio: Buffer): Promise<Transcription> {
    const wav = await toWav(audio);
    const config = sdk.SpeechConfig.fromSubscription(this.key, this.region);
    config.speechRecognitionLanguage = this.language;
    config.outputFormat = sdk.OutputFormat.Detailed;
    const audioConfig = sdk.AudioConfig.fromWavFileInput(wav);
    const recognizer = new sdk.SpeechRecognizer(config, audioConfig);
    // An empty reference means the speech is unscripted, which is how IELTS answers work.
    const assessment = new sdk.PronunciationAssessmentConfig("", sdk.PronunciationAssessmentGradingSystem.HundredMark, sdk.PronunciationAssessmentGranularity.Word, false);
    assessment.enableProsodyAssessment = true;
    assessment.applyTo(recognizer);

    const segments: AzureSegment[] = [];
    await new Promise<void>((resolve, reject) => {
      recognizer.recognized = (_sender, event) => {
        if (event.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
        const json = event.result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult);
        if (json) segments.push(JSON.parse(json) as AzureSegment);
      };
      recognizer.canceled = (_sender, event) => {
        if (event.reason === sdk.CancellationReason.EndOfStream) resolve();
        else if (event.errorCode === sdk.CancellationErrorCode.AuthenticationFailure) reject(new AiError("NOT_CONFIGURED", "The speech service rejected its credentials.", false));
        else reject(new AiError("PROVIDER_ERROR", "The speech service had a problem.", true));
      };
      recognizer.sessionStopped = () => resolve();
      recognizer.startContinuousRecognitionAsync(undefined, () => reject(new AiError("PROVIDER_ERROR", "The speech service couldn't start.", true)));
    }).finally(() => {
      recognizer.close();
    });

    const words: WordTiming[] = [];
    const scores = { accuracy: [] as number[], fluency: [] as number[], prosody: [] as number[], overall: [] as number[] };
    const parts: string[] = [];
    for (const segment of segments) {
      const best = segment.NBest?.[0];
      parts.push(best?.Display ?? segment.DisplayText ?? "");
      for (const word of best?.Words ?? []) {
        // Azure reports time in units of 100 nanoseconds.
        words.push({ word: word.Word, offsetMs: Math.round(word.Offset / 10_000), durationMs: Math.round(word.Duration / 10_000), accuracyScore: word.PronunciationAssessment?.AccuracyScore ?? null });
      }
      const measures = best?.PronunciationAssessment;
      if (measures?.AccuracyScore !== undefined) scores.accuracy.push(measures.AccuracyScore);
      if (measures?.FluencyScore !== undefined) scores.fluency.push(measures.FluencyScore);
      if (measures?.ProsodyScore !== undefined) scores.prosody.push(measures.ProsodyScore);
      if (measures?.PronScore !== undefined) scores.overall.push(measures.PronScore);
    }
    const last = words.at(-1);
    return {
      transcript: parts.filter(Boolean).join(" ").trim(),
      words,
      pronunciation: scores.accuracy.length ? { accuracyScore: average(scores.accuracy), fluencyScore: average(scores.fluency), prosodyScore: average(scores.prosody), pronunciationScore: average(scores.overall) } : null,
      durationMs: last ? last.offsetMs + last.durationMs : 0,
    };
  }
}

/** Delivery measures worked out by code from word timings, so the AI doesn't have to guess them from text. */
export function fluencyMetrics(words: WordTiming[]) {
  if (words.length < 2) return { wordCount: words.length, wordsPerMinute: 0, pauseCount: 0, longPauseCount: 0, speakingSeconds: 0 };
  const first = words[0]!;
  const last = words.at(-1)!;
  const spanMs = last.offsetMs + last.durationMs - first.offsetMs;
  let pauseCount = 0;
  let longPauseCount = 0;
  for (let index = 1; index < words.length; index += 1) {
    const previous = words[index - 1]!;
    const gap = words[index]!.offsetMs - (previous.offsetMs + previous.durationMs);
    if (gap >= 500) pauseCount += 1;
    if (gap >= 1500) longPauseCount += 1;
  }
  return { wordCount: words.length, wordsPerMinute: spanMs ? Math.round((words.length / spanMs) * 60_000) : 0, pauseCount, longPauseCount, speakingSeconds: Math.round(spanMs / 1000) };
}
