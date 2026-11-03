"use client";

import { AlertTriangle, CheckCircle2, Mic, RotateCcw, Square, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiRequestError } from "@/lib/api-client";
import { formatClock } from "./exam-frame";

type Stage = "idle" | "requesting" | "preparing" | "recording" | "review" | "uploading" | "saved";
type Problem = "denied" | "noDevice" | "busy" | "unsupported" | "interrupted" | "uploadFailed" | "closed" | null;

const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

const supportedType = () => (typeof MediaRecorder === "undefined" ? null : (TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? ""));

/** Records in the browser, lets the student listen back, and uploads only when they choose to. Failed uploads keep the recording, so they can retry. */
export function Recorder({ basePath, prepSeconds, maxSeconds, hasRecording, savedDuration, onChange }: { basePath: string; prepSeconds: number; maxSeconds: number; hasRecording: boolean; savedDuration: number | null; onChange?: (saved: boolean) => void }) {
  const t = useTranslations("practice.recorder");
  const [stage, setStage] = useState<Stage>(hasRecording ? "saved" : "idle");
  const [problem, setProblem] = useState<Problem>(null);
  const [left, setLeft] = useState(0);
  const [duration, setDuration] = useState(savedDuration ?? 0);
  const [preview, setPreview] = useState<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const blob = useRef<Blob | null>(null);
  const stopping = useRef(false);

  const releaseMic = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  useEffect(() => releaseMic, [releaseMic]);
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const finish = useCallback(() => {
    const active = recorder.current;
    if (active && active.state !== "inactive") {
      stopping.current = true;
      active.stop();
    }
  }, []);

  const beginRecording = useCallback(() => {
    const media = stream.current;
    const type = supportedType();
    if (!media || type === null) {
      setProblem("unsupported");
      setStage("idle");
      return;
    }
    chunks.current = [];
    stopping.current = false;
    const active = new MediaRecorder(media, type ? { mimeType: type } : undefined);
    recorder.current = active;
    active.ondataavailable = (event) => {
      if (event.data.size) chunks.current.push(event.data);
    };
    // A device being unplugged ends the tracks. Whatever was captured is kept for review.
    active.onerror = () => {
      setProblem("interrupted");
      finish();
    };
    media.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (!stopping.current) {
          setProblem("interrupted");
          finish();
        }
      };
    });
    active.onstop = () => {
      releaseMic();
      const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
      setDuration(seconds);
      const recorded = new Blob(chunks.current, { type: active.mimeType || "audio/webm" });
      if (!recorded.size) {
        setProblem("interrupted");
        setStage("idle");
        return;
      }
      blob.current = recorded;
      setPreview(URL.createObjectURL(recorded));
      setStage("review");
    };
    active.start(1000);
    startedAt.current = Date.now();
    setLeft(maxSeconds);
    setStage("recording");
  }, [finish, maxSeconds, releaseMic]);

  // The clock for preparing and speaking. Reaching zero moves on without a click.
  useEffect(() => {
    if (stage !== "preparing" && stage !== "recording") return;
    const timer = setInterval(() => {
      setLeft((value) => {
        if (value > 1) return value - 1;
        clearInterval(timer);
        if (stage === "preparing") beginRecording();
        else finish();
        return 0;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [beginRecording, finish, stage]);

  async function start() {
    setProblem(null);
    if (supportedType() === null || !navigator.mediaDevices?.getUserMedia) {
      setProblem("unsupported");
      return;
    }
    setStage("requesting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const name = (error as DOMException).name;
      setProblem(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "noDevice" : "busy");
      setStage("idle");
      return;
    }
    if (prepSeconds > 0) {
      setLeft(prepSeconds);
      setStage("preparing");
    } else {
      beginRecording();
    }
  }

  async function upload() {
    if (!blob.current) return;
    setProblem(null);
    setStage("uploading");
    try {
      await api.put(`${basePath}?durationSeconds=${Math.min(600, duration)}`, blob.current);
      setStage("saved");
      onChange?.(true);
    } catch (error) {
      setProblem(error instanceof ApiRequestError && [409, 410].includes(error.status) ? "closed" : "uploadFailed");
      setStage("review");
    }
  }

  async function discardSaved() {
    try {
      await api.delete(basePath);
      blob.current = null;
      setPreview(null);
      setStage("idle");
      onChange?.(false);
    } catch (error) {
      setProblem(error instanceof ApiRequestError && [409, 410].includes(error.status) ? "closed" : "uploadFailed");
    }
  }

  const reset = () => {
    blob.current = null;
    setPreview(null);
    setProblem(null);
    setStage("idle");
  };

  return (
    <section aria-label={t("label")} className="bg-card shadow-soft rounded-xl border p-5">
      {problem && (
        <p role="alert" className="text-destructive mb-3 flex items-start gap-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {t(`problems.${problem}`)}
        </p>
      )}
      <p aria-live="polite" className="text-center font-medium">{t(`stages.${stage}`)}</p>
      {(stage === "preparing" || stage === "recording") && <p role="timer" className="font-display mt-1 text-center text-3xl font-semibold tabular-nums">{formatClock(left)}</p>}
      {stage === "recording" && (
        <div aria-hidden className="waveform mt-3 flex h-10 items-center justify-center gap-1">
          {Array.from({ length: 24 }, (_, index) => <span key={index} className="bg-primary h-full w-1 rounded-full" style={{ animationDelay: `${(index % 7) * 0.09}s` }} />)}
        </div>
      )}
      {preview && (stage === "review" || stage === "uploading") && (
        <>
          {/* The student's own speech, played back for checking, so captions don't apply. */}
          <audio controls src={preview} aria-label={t("preview")} className="mt-3 w-full" />
        </>
      )}
      {stage === "saved" && <p className="text-success mt-1 flex items-center justify-center gap-1.5 text-sm font-medium"><CheckCircle2 className="size-4" aria-hidden /> {t("savedLength", { time: formatClock(duration) })}</p>}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {stage === "idle" && <Button size="lg" onClick={() => void start()}><Mic aria-hidden /> {prepSeconds > 0 ? t("startPreparing") : t("startRecording")}</Button>}
        {stage === "preparing" && <Button size="lg" onClick={beginRecording}><Mic aria-hidden /> {t("startRecording")}</Button>}
        {stage === "recording" && <Button size="lg" variant="destructive" onClick={finish}><Square aria-hidden /> {t("stop")}</Button>}
        {stage === "review" && (
          <>
            <Button size="lg" onClick={() => void upload()}><Upload aria-hidden /> {problem === "uploadFailed" ? t("retryUpload") : t("saveRecording")}</Button>
            <Button size="lg" variant="outline" onClick={reset}><RotateCcw aria-hidden /> {t("recordAgain")}</Button>
          </>
        )}
        {stage === "saved" && <Button variant="outline" onClick={() => void discardSaved()}><Trash2 aria-hidden /> {t("deleteAndRetry")}</Button>}
      </div>
    </section>
  );
}
