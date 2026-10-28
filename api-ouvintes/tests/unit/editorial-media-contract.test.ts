import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../../src/config/env.js", () => ({
  env: {
    FEED_ENABLED: true,
    FEED_NAMESPACE: "contract-test",
    FEED_PRIVATE_BUCKET_NAME: "private-test",
    FEED_MAX_UPLOAD_BYTES: 50 * 1024 * 1024,
    R2_ACCOUNT_ID: "test-account",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
  },
}));
vi.mock("../../src/database/client.js", () => ({ pool: { query: mocks.query } }));
vi.mock("../../src/services/editorial/operation-lock.js", () => ({
  withEditorialLock: (_key: string, operation: (db: { query: typeof mocks.query }) => unknown) =>
    operation({ query: mocks.query }),
}));
vi.mock("../../src/services/editorial/video-validation.js", () => ({
  inspectEditorialMp4: vi.fn(() => ({ width: 1920, height: 1080, durationMs: 4000 })),
}));

import { completeEditorialUpload, createEditorialUpload, listEditorialMedia } from "../../src/services/editorial/media-service.js";

const createdAt = "2026-10-28T12:00:00.000Z";
const mediaKinds = [
  { mediaType: "image", mimeType: "image/png", durationMs: null, frameCount: 1 },
  { mediaType: "gif", mimeType: "image/gif", durationMs: 1200, frameCount: 12 },
  { mediaType: "video", mimeType: "video/mp4", durationMs: 4000, frameCount: null },
] as const;

function rowFor(kind = mediaKinds[0] as typeof mediaKinds[number]) {
  return {
    id: "test-asset", media_type: kind.mediaType, mime_type: kind.mimeType,
    byte_size: "2048", original_name: "original-media", width: 1920, height: 1080,
    duration_ms: kind.durationMs, frame_count: kind.frameCount, status: "ready",
    created_at: new Date(createdAt),
    private_object_key: "feed-private/contract-test/test-asset/original",
    poster_object_key: "private-poster", checksum_sha256: null,
    created_by_admin_user_id: "test-admin", private_variants: [],
  };
}

describe("editorial media API contract for the painel", () => {
  beforeEach(() => { mocks.query.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each(mediaKinds)("lists $mediaType with camelCase metadata and a numeric byteSize", async (kind) => {
    mocks.query.mockResolvedValue({ rows: [rowFor(kind)], rowCount: 1 });

    const result = await listEditorialMedia("test-admin", 2, 10);

    expect(result).toEqual({
      page: 2, pageSize: 10,
      items: [{
        id: "test-asset", mediaType: kind.mediaType, mimeType: kind.mimeType,
        byteSize: 2048, originalName: "original-media", width: 1920, height: 1080,
        durationMs: kind.durationMs, frameCount: kind.frameCount, status: "ready",
        createdAt, previewUrl: expect.any(String),
      }],
    });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("duration_ms"), ["test-admin", 10, 10]);
    const preview = new URL(result.items[0]!.previewUrl!);
    expect(preview.pathname).toBe("/private-test/feed-private/contract-test/test-asset/original");
    expect(preview.searchParams.get("X-Amz-Expires")).toBe("300");
    // This is the picker filter that failed when the API returned media_type.
    expect(result.items.filter((asset) => asset.mediaType === kind.mediaType)).toHaveLength(1);
  });

  it.each(["uploading", "rejected"])("keeps %s media metadata nullable and its preview private", async (status) => {
    mocks.query.mockResolvedValue({ rows: [{
      ...rowFor(), status, width: null, height: null, duration_ms: null, frame_count: null,
      created_at: createdAt,
    }], rowCount: 1 });

    const result = await listEditorialMedia("test-admin", 1, 50);

    expect(result.items).toEqual([{
      id: "test-asset", mediaType: "image", mimeType: "image/png", byteSize: 2048,
      originalName: "original-media", width: null, height: null, durationMs: null,
      frameCount: null, status, createdAt, previewUrl: null,
    }]);
  });

  it("normalizes the reserved upload asset without changing the upload instructions", async () => {
    mocks.query.mockResolvedValue({ rows: [{
      id: "reserved-asset", media_type: "image", mime_type: "image/png", byte_size: "2048",
      original_name: "photo.png", status: "uploading", created_at: createdAt,
    }], rowCount: 1 });

    const result = await createEditorialUpload({
      mediaType: "image", mimeType: "image/png", byteSize: 2048,
      filename: "photo.png", adminUserId: "test-admin",
    });

    expect(result).toEqual({
      asset: {
        id: "reserved-asset", mediaType: "image", mimeType: "image/png", byteSize: 2048,
        originalName: "photo.png", status: "uploading", createdAt,
        width: null, height: null, durationMs: null, frameCount: null,
      },
      uploadUrl: expect.any(String), expiresInSeconds: 300,
      requiredHeaders: { "Content-Type": "image/png" },
    });
  });

  it.each([mediaKinds[0], mediaKinds[2]])("normalizes completed $mediaType uploads without leaking storage fields", async (kind) => {
    const bytes = kind.mediaType === "image"
      ? await sharp({ create: { width: 64, height: 48, channels: 3, background: "white" } }).png().toBuffer()
      : Buffer.alloc(64);
    if (kind.mediaType === "video") {
      // MP4 signature; detailed video inspection is stubbed for this contract test.
      bytes.writeUInt32BE(24, 0);
      bytes.write("ftypisom", 4);
      bytes.write("isommp42", 16);
    }
    const asset = { ...rowFor(kind), status: "uploading", byte_size: String(bytes.length) };
    mocks.query.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.startsWith("SELECT")) return { rows: [asset], rowCount: 1 };
      if (sql.includes("SET status='ready'")) return { rows: [{
        ...asset, status: "ready", width: values[1], height: values[2],
        duration_ms: values[3], frame_count: values[4],
      }], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) return { ETag: "test-etag", ContentLength: bytes.length, ContentType: kind.mimeType };
      if (command instanceof GetObjectCommand) {
        if (command.input.Range) return {
          $metadata: { httpStatusCode: 206 }, ContentRange: `bytes 0-31/${bytes.length}`,
          Body: { transformToByteArray: async () => bytes.subarray(0, 32) },
        };
        return {
          ETag: "test-etag", ContentType: kind.mimeType,
          Body: { async *[Symbol.asyncIterator]() { yield bytes; } },
        };
      }
      if (command instanceof PutObjectCommand) return {};
      throw new Error("Unexpected storage command");
    });

    const result = await completeEditorialUpload("test-asset", "test-admin");

    expect(result).toEqual({
      id: "test-asset", mediaType: kind.mediaType, mimeType: kind.mimeType,
      byteSize: bytes.length, originalName: "original-media", status: "ready", createdAt,
      width: kind.mediaType === "image" ? 64 : 1920,
      height: kind.mediaType === "image" ? 48 : 1080,
      durationMs: kind.durationMs, frameCount: null,
    });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringMatching(/RETURNING[\s\S]*duration_ms/), expect.any(Array));
  });
});
