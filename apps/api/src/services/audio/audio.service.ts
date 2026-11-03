import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const PROCESS_TIMEOUT_MS = 120_000;
const MAX_LOG_BYTES = 64 * 1024;

export class AudioError extends Error {
  constructor(
    message: string,
    readonly kind: "UNAVAILABLE" | "INVALID",
  ) {
    super(message);
    this.name = "AudioError";
  }
}

export type AudioInfo = { durationSeconds: number; codec: string | null; sampleRate: number | null; channels: number | null; bitrateKbps: number | null };

/** A path set in the server's settings wins. Otherwise the project's own ffmpeg is used, never a system install by default. */
export function ffmpegPath() {
  const configured = process.env.FFMPEG_PATH;
  if (configured && configured !== "ffmpeg") return configured;
  const bundled = require("ffmpeg-static") as string | null;
  if (!bundled) throw new AudioError("The audio tool isn't available.", "UNAVAILABLE");
  return bundled;
}

/**
 * Runs ffmpeg on a private temporary copy and always removes it, because it may be a student's voice.
 * Only local files can be read, so a crafted file can't make ffmpeg fetch anything from the network.
 */
async function runFfmpeg<T>(input: Buffer, args: (paths: { input: string; output: string }) => string[], collect: (result: { log: string; code: number | null; output: string }) => Promise<T> | T) {
  const binary = ffmpegPath();
  const folder = await mkdtemp(path.join(tmpdir(), "ieltiva-audio-"));
  const paths = { input: path.join(folder, "input"), output: path.join(folder, "output.wav") };
  try {
    await writeFile(paths.input, input, { mode: 0o600 });
    const { code, log } = await new Promise<{ code: number | null; log: string }>((resolve, reject) => {
      const child = spawn(binary, ["-nostdin", "-hide_banner", "-protocol_whitelist", "file", ...args(paths)], { stdio: ["ignore", "ignore", "pipe"] });
      let text = "";
      child.stderr.on("data", (chunk: Buffer) => {
        if (text.length < MAX_LOG_BYTES) text += chunk.toString("utf8");
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), PROCESS_TIMEOUT_MS);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (exit) => {
        clearTimeout(timer);
        resolve({ code: exit, log: text });
      });
    });
    return await collect({ log, code, output: paths.output });
  } catch (error) {
    if (error instanceof AudioError) throw error;
    throw new AudioError("The audio tool couldn't run.", "UNAVAILABLE");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** Reads what the audio really is from ffmpeg's own description of it. */
export function parseAudioInfo(log: string): AudioInfo | null {
  const duration = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(log);
  const stream = /Stream #[^\n]*Audio:\s*([^,\s(]+)[^\n]*/.exec(log);
  if (!stream) return null;
  const line = stream[0];
  const rate = /(\d+)\s*Hz/.exec(line);
  const bits = /(\d+)\s*kb\/s/.exec(line);
  const channels = /\b(mono|stereo)\b/.exec(line);
  const seconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0;
  return {
    durationSeconds: Math.round(seconds),
    codec: stream[1] ?? null,
    sampleRate: rate ? Number(rate[1]) : null,
    channels: channels ? (channels[1] === "mono" ? 1 : 2) : null,
    bitrateKbps: bits ? Number(bits[1]) : null,
  };
}

/** Throws INVALID when ffmpeg can't find any audio in the file, whatever its first bytes claimed. */
export async function probeAudio(data: Buffer): Promise<AudioInfo> {
  return runFfmpeg(
    data,
    ({ input }) => ["-i", input],
    // ffmpeg exits with an error when no output is given, so only the description matters here.
    ({ log }) => {
      const info = parseAudioInfo(log);
      if (!info) throw new AudioError("This file doesn't contain readable audio.", "INVALID");
      return info;
    },
  );
}

/** The 16 kHz mono format the speech recogniser needs. */
export async function convertToWav(data: Buffer): Promise<Buffer> {
  return runFfmpeg(
    data,
    ({ input, output }) => ["-y", "-loglevel", "error", "-i", input, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", output],
    async ({ code, output }) => {
      if (code !== 0) throw new AudioError("This recording couldn't be read.", "INVALID");
      return readFile(output);
    },
  );
}
