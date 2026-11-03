import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { assertSafeKey, type PrivateStorage, type PutOptions, type SignedLinkOptions } from "./private-storage.js";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Student files and shared teaching content are kept apart, so one bucket's policy can't expose the other. */
  buckets: { user: string; content: string };
};

const USER_PREFIXES = ["recordings/", "avatars/", "reports/", "calibration/"];

/** Cloudflare R2 through its S3-compatible API. Buckets must be private, and credentials are only ever read on the server. */
export class R2PrivateStorage implements PrivateStorage {
  readonly kind = "r2";
  private readonly client: S3Client;

  constructor(private readonly config: R2Config) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  private bucketFor(key: string) {
    return USER_PREFIXES.some((prefix) => key.startsWith(prefix)) ? this.config.buckets.user : this.config.buckets.content;
  }

  async put(key: string, data: Buffer, options?: PutOptions) {
    assertSafeKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucketFor(key), Key: key, Body: data, ...(options?.contentType ? { ContentType: options.contentType } : {}) }));
  }

  async get(key: string) {
    assertSafeKey(key);
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucketFor(key), Key: key }));
      const bytes = await result.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return null;
      throw error;
    }
  }

  async delete(key: string) {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketFor(key), Key: key }));
  }

  /** A link that works for a short time and only for this one file. It's handed out only after an access check. */
  async signedDownloadUrl(key: string, options: SignedLinkOptions) {
    assertSafeKey(key);
    const command = new GetObjectCommand({
      Bucket: this.bucketFor(key),
      Key: key,
      ...(options.fileName ? { ResponseContentDisposition: `attachment; filename="${options.fileName}"` } : {}),
      ...(options.contentType ? { ResponseContentType: options.contentType } : {}),
    });
    return getSignedUrl(this.client, command, { expiresIn: options.expiresSeconds });
  }

  async check() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.buckets.user }));
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.buckets.content }));
  }
}
