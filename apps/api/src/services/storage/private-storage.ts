import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../utils/app-error.js";

export type PutOptions = { contentType?: string };
export type SignedLinkOptions = { expiresSeconds: number; fileName?: string; contentType?: string };

/**
 * Files are private. Callers check access first and then stream the file or, where the provider supports it,
 * hand out a link that works briefly for that one file. Storage credentials never reach a client.
 */
export interface PrivateStorage {
  readonly kind: string;
  put(key: string, data: Buffer, options?: PutOptions): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  signedDownloadUrl?(key: string, options: SignedLinkOptions): Promise<string | null>;
  /** Confirms the storage can be reached, for the operations page. */
  check?(): Promise<void>;
}

/** Keys are built by our own code, and this refuses any that could reach outside its folder if that ever changes. */
export function assertSafeKey(key: string) {
  if (!key || key.startsWith("/") || key.includes("\\") || key.split("/").some((part) => part === ".." || part === ".")) throw new Error("Invalid storage key");
}

export class LocalPrivateStorage implements PrivateStorage {
  readonly kind = "local";

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

/** Used when no storage is configured, so production can't silently write to a server's disk. */
export class UnavailableStorage implements PrivateStorage {
  readonly kind = "unavailable";

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
