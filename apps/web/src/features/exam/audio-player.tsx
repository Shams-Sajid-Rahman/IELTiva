"use client";

import { Headphones, Pause, Play, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatClock } from "./exam-frame";

/** Builds a short, quiet tone in the browser, so the player can be tried before any real recordings exist. */
function makeSampleTone(seconds: number) {
  const rate = 8000;
  const samples = seconds * rate;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index += 1) {
    const time = index / rate;
    const pulse = Math.sin(Math.PI * ((time % 1) / 1)) ** 2;
    view.setInt16(44 + index * 2, Math.sin(2 * Math.PI * 330 * time) * pulse * 3000, true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

const DURATION = 20;

export function AudioPlayer() {
  const t = useTranslations("exam.listening");
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (source) URL.revokeObjectURL(source);
    };
  }, [source]);

  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);

  function toggle() {
    if (playing) {
      audio.current?.pause();
      return;
    }
    if (!source) setSource(makeSampleTone(DURATION));
    else void audio.current?.play();
  }

  return (
    <section aria-label={t("player")} className="bg-card shadow-soft rounded-xl border p-4">
      {/* The sample is a wordless tone, so there's nothing to caption. Real recordings will come with transcripts. */}
      <audio
        ref={audio}
        src={source ?? undefined}
        onCanPlay={() => { if (!playing && time === 0) void audio.current?.play(); }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setTime(0); }}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
      />
      <div className="flex items-center gap-3">
        <Button size="icon" aria-label={playing ? t("pause") : t("play")} onClick={toggle} className="size-11 shrink-0 rounded-full">
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="inline-flex min-w-0 items-center gap-1.5 font-medium"><Headphones className="size-4 shrink-0" aria-hidden /><span className="truncate">{t("recording")}</span></span>
            <span className="text-muted-foreground shrink-0 tabular-nums">{formatClock(Math.round(time))} / {formatClock(DURATION)}</span>
          </div>
          <Progress className="mt-2" value={(time / DURATION) * 100} aria-label={t("played")} />
        </div>
        <label className="hidden items-center gap-2 sm:flex">
          <Volume2 className="text-muted-foreground size-4" aria-hidden />
          <span className="sr-only">{t("volume")}</span>
          <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="accent-primary w-24" />
        </label>
      </div>
      <p className="text-muted-foreground mt-3 text-xs">{t("playerNote")}</p>
    </section>
  );
}
