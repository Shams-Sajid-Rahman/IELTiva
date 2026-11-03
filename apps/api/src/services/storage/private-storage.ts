import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../utils/app-error.js";

/** Files are private. Callers stream them after an access check, and no storage URL ever reaches a client. */
export interface PrivateStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export class LocalPrivateStorage implements PrivateStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return target;
  }

  async put(key: string, data: Buffer) {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async get(key: string) {
    try {
      return await readFile(this.resolve(key));
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

/** Used until the Cloudflare R2 provider exists, so production can't silently write to a server's disk. */
export class UnavailableStorage implements PrivateStorage {
  private fail(): never {
    throw new AppError(503, "SERVICE_UNAVAILABLE", "File storage isn't available yet.");
  }
  async put(): Promise<void> {
    this.fail();
  }
  async get(): Promise<Buffer | null> {
    return null;
  }
  async delete(): Promise<void> {}
}

type Signature = { contentType: string; extension: string; matches: (data: Buffer) => boolean };

const IMAGE_TYPES: Signature[] = [
  { contentType: "image/png", extension: "png", matches: (d) => d.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { contentType: "image/jpeg", extension: "jpg", matches: (d) => d.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  {
    contentType: "image/webp",
    extension: "webp",
    matches: (d) => d.subarray(0, 4).toString("latin1") === "RIFF" && d.subarray(8, 12).toString("latin1") === "WEBP",
  },
];

/** Checks the file's real bytes, so a renamed script or SVG can't pass as a photo. */
export function detectImageType(data: Buffer) {
  return IMAGE_TYPES.find((type) => type.matches(data)) ?? null;
}

export function contentTypeForKey(key: string) {
  return IMAGE_TYPES.find((type) => key.endsWith(`.${type.extension}`))?.contentType ?? "application/octet-stream";
}
