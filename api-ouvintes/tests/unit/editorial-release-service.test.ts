import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), bypassSecret: undefined as string | undefined }));

vi.mock("../../src/config/env.js", () => ({
  env: {
    FEED_PUBLICATION_ENABLED: true,
    FEED_NAMESPACE: "test/feed",
    FEED_DEPLOY_HOOK_URL: "https://deploy.example.test/hook",
    FEED_SITE_BASE_URL: "https://site.example.test",
    FEED_PRIVATE_BUCKET_NAME: "private-test",
    R2_ACCOUNT_ID: "test-account",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
    R2_BUCKET_NAME: "public-test",
    R2_PUBLIC_BASE_URL: "https://media.example.test",
    get FEED_SITE_PROTECTION_BYPASS_SECRET() { return mocks.bypassSecret; },
  },
}));
vi.mock("../../src/database/client.js", () => ({ pool: { query: mocks.query } }));
vi.mock("../../src/services/editorial/operation-lock.js", () => ({
  withEditorialLock: (_key: string, operation: (db: { query: typeof mocks.query }) => unknown) =>
    operation({ query: mocks.query }),
}));

import { checkEditorialRelease, requestEditorialRelease, retryEditorialRelease } from "../../src/services/editorial/release-service.js";

const publishedAt = "2026-10-28T12:00:00.000Z";
const asset = {
  id: "cover-asset",
  media_type: "image",
  private_object_key: "feed-private/test/feed/cover-asset/validated-cover.webp",
  private_variants: [],
  mime_type: "image/webp",
  byte_size: 100,
  status: "ready",
};

describe("editorial release eventDate contract", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.bypassSecret = undefined;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job: { id: "test-job" } }),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    { eventDate: "2025-12-31", expected: "2025-12-31" },
    { eventDate: "2026-01-01", expected: "2026-01-01" },
    { eventDate: "2024-02-29", expected: "2024-02-29" },
    { eventDate: null, expected: null },
    { eventDate: undefined, expected: null },
  ])("propagates $eventDate as $expected without changing the v1 contract", async ({ eventDate, expected }) => {
    const uploads = new Map<string, Buffer>();
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
      if (command instanceof PutObjectCommand) {
        uploads.set(command.input.Key!, Buffer.from(command.input.Body as Uint8Array));
      }
      if (command instanceof GetObjectCommand) {
        return {}; // No previous candidate to restore.
      }
      return {};
    });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("AND idempotency_key=$2")) {
        return {
          rowCount: 1,
          rows: [{
            id: "test-release",
            status: "failed",
            sequence: 1,
            created_at: publishedAt,
            revision_ids: [{
              postId: "test-post",
              revisionId: "test-revision",
              operation: "publish",
              slug: "test-event",
              publishedAt,
              snapshotVersion: 1,
            }],
          }],
        };
      }
      if (sql.includes("WHERE r.id=ANY")) {
        return {
          rowCount: 1,
          rows: [{
            post_id: "test-post",
            revision_id: "test-revision",
            revision_number: 1,
            slug: "test-event",
            title: "Test event",
            excerpt: "Occurrence date differs from publication date.",
            cover_asset_id: asset.id,
            cover_alt: "Test cover",
            cover_focus_x: 50,
            cover_focus_y: 50,
            blocks: [],
            category_snapshot: { slug: "events", name: "Events" },
            event_date: eventDate,
            first_published_at: publishedAt,
            revision_created_at: publishedAt,
          }],
        };
      }
      if (sql.includes("FROM editorial_media_asset")) {
        return { rowCount: 1, rows: [asset] };
      }
      return { rowCount: 0, rows: [] };
    });

    await expect(requestEditorialRelease({
      postId: "test-post",
      revisionId: "test-revision",
      idempotencyKey: "test-request",
      adminUserId: "test-admin",
    })).resolves.toMatchObject({ status: "awaiting_confirmation" });

    // Format the SQL DATE before pg can turn local midnight into a JS Date.
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("to_char(r.event_date, 'YYYY-MM-DD') AS event_date"),
      [["test-revision"]],
    );
    const postKey = "feed/test/feed/releases/test-release/posts/test-event.json";
    const postBytes = uploads.get(postKey)!;
    const document = JSON.parse(postBytes.toString());
    const manifest = JSON.parse(uploads.get("feed/test/feed/releases/test-release/manifest.json")!.toString());

    expect(document).toMatchObject({ schemaVersion: 1, post: { eventDate: expected, publishedAt } });
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      namespace: "test/feed",
      releaseId: "test-release",
      posts: [{
        id: "test-post",
        slug: "test-event",
        title: "Test event",
        excerpt: document.post.excerpt,
        cover: document.post.cover,
        category: document.post.category,
        eventDate: expected,
        publishedAt,
        postKey,
        postSha256: createHash("sha256").update(postBytes).digest("hex"),
      }],
    });
  });
});

const requestInput = {
  postId: "test-post", revisionId: "test-revision",
  idempotencyKey: "test-request", adminUserId: "test-admin",
};
const candidateKey = "feed/test/feed/candidate.json";

function setupReleaseFlow(status = "failed") {
  const release = {
    id: "test-release", namespace: "test/feed", status, sequence: 2,
    manifest_sha256: "test-manifest-hash", deploy_job_id: null as string | null,
    error_code: null as string | null, created_at: publishedAt,
    idempotency_key: requestInput.idempotencyKey,
    revision_ids: [{
      postId: requestInput.postId, revisionId: requestInput.revisionId,
      operation: "publish", slug: "test-event", publishedAt, snapshotVersion: 1,
    }],
  };
  const live = { id: "previous-release", manifest_sha256: "previous-hash" };
  const markerFor = (entry: typeof live) => ({
    schemaVersion: 1, namespace: "test/feed", releaseId: entry.id, manifestSha256: entry.manifest_sha256,
  });
  const previousCandidate = Buffer.from(JSON.stringify({
    ...markerFor(live), manifestKey: "feed/test/feed/releases/previous-release/manifest.json",
  }));
  const currentCandidate = () => Buffer.from(JSON.stringify({
    ...markerFor(release), manifestKey: "feed/test/feed/releases/test-release/manifest.json",
  }));
  const objects = new Map([[candidateKey, status === "failed" ? previousCandidate : currentCandidate()]]);
  const hook = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ job: { id: "test-job" } }) });
  const marker = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => markerFor(live) });
  const fetchMock = vi.fn().mockImplementation((url: string, options: RequestInit) =>
    options.method === "POST" ? hook(url, options) : marker(url, options));
  vi.stubGlobal("fetch", fetchMock);
  const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
    if (command instanceof PutObjectCommand) {
      objects.set(command.input.Key!, Buffer.from(command.input.Body as Uint8Array));
    }
    if (command instanceof DeleteObjectCommand) {
      objects.delete(command.input.Key!);
    }
    if (command instanceof GetObjectCommand) {
      const bytes = objects.get(command.input.Key!);
      return bytes ? { Body: { transformToByteArray: async () => bytes } } : {};
    }
    return {};
  });
  const state = { newer: false, live: true };
  mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("AND idempotency_key=$2") || sql.includes("WHERE id=$1 AND namespace=$2")) {
      return { rowCount: 1, rows: [release] };
    }
    if (/sequence\s*>\s*\$2/.test(sql)) {
      return { rowCount: state.newer ? 1 : 0, rows: state.newer ? [{ id: "newer-release" }] : [] };
    }
    if (sql.includes("status='live' ORDER BY")) {
      return { rowCount: state.live ? 1 : 0, rows: state.live ? [live] : [] };
    }
    if (sql.includes("WHERE r.id=ANY")) {
      return { rowCount: 1, rows: [{
        post_id: requestInput.postId, revision_id: requestInput.revisionId,
        revision_number: 1, slug: "test-event", title: "Test event", excerpt: "Test excerpt",
        cover_asset_id: asset.id, cover_alt: "Test cover", blocks: [],
        category_snapshot: {}, event_date: "2025-12-31", revision_created_at: publishedAt,
      }] };
    }
    if (sql.includes("FROM editorial_media_asset")) {
      return { rowCount: 1, rows: [asset] };
    }
    if (sql.includes("SET manifest_key=$2")) {
      release.manifest_sha256 = values[2] as string;
    }
    if (sql.includes("SET status=$2")) {
      release.status = values[1] as string;
      release.error_code = values[2] as string;
    }
    for (const next of ["preparing", "building", "awaiting_confirmation", "live"]) {
      if (sql.includes(`SET status='${next}'`)) {
        release.status = next;
      }
    }
    return { rowCount: 0, rows: [] };
  });
  return { release, live, markerFor, objects, previousCandidate, currentCandidate, hook, marker, fetchMock, send, state };
}

describe("editorial release failure recovery", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.bypassSecret = undefined;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([400, 401, 429, 500, 503])("restores the previous candidate and fails on explicit hook HTTP %s", async (status) => {
    const flow = setupReleaseFlow();
    flow.hook.mockResolvedValue({ ok: false, status });

    await expect(requestEditorialRelease(requestInput)).rejects.toMatchObject({ code: "FEED_DEPLOY_HOOK_REJECTED" });

    expect(flow.release).toMatchObject({ status: "failed", error_code: "DEPLOY_HOOK_REJECTED" });
    expect(flow.objects.get(candidateKey)).toEqual(flow.previousCandidate);
  });

  it("removes a rejected candidate when none existed before", async () => {
    const flow = setupReleaseFlow();
    flow.objects.delete(candidateKey);
    flow.hook.mockResolvedValue({ ok: false, status: 503 });

    await expect(requestEditorialRelease(requestInput)).rejects.toMatchObject({ code: "FEED_DEPLOY_HOOK_REJECTED" });

    expect(flow.objects.has(candidateKey)).toBe(false);
    expect(flow.release.status).toBe("failed");
  });

  it("allows an explicitly rejected release to be retried", async () => {
    const flow = setupReleaseFlow();
    flow.hook.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(requestEditorialRelease(requestInput)).rejects.toMatchObject({ code: "FEED_DEPLOY_HOOK_REJECTED" });

    await expect(retryEditorialRelease("test-release", "test-admin")).resolves.toMatchObject({ status: "awaiting_confirmation", duplicate: false });

    expect(flow.hook).toHaveBeenCalledTimes(2);
    expect(JSON.parse(flow.objects.get(candidateKey)!.toString()).releaseId).toBe("test-release");
  });

  it.each([new TypeError("network error"), new DOMException("timed out", "TimeoutError")])("preserves an uncertain hook outcome: %s", async (error) => {
    const flow = setupReleaseFlow();
    flow.hook.mockRejectedValueOnce(error);

    await expect(requestEditorialRelease(requestInput)).rejects.toMatchObject({ code: "FEED_RELEASE_FAILED" });

    expect(flow.release).toMatchObject({ status: "awaiting_confirmation", error_code: "DEPLOY_HOOK_UNCERTAIN" });
    expect(JSON.parse(flow.objects.get(candidateKey)!.toString()).releaseId).toBe("test-release");
  });

  it("keeps an uncertain restoration awaiting confirmation", async () => {
    const flow = setupReleaseFlow();
    const sendNormally = flow.send.getMockImplementation()!;
    // objectBuffer returns a copy, so identify the restoration by its bytes.
    flow.send.mockImplementation(async (...args) => {
      const command = args[0];
      if (command instanceof PutObjectCommand && command.input.Key === candidateKey &&
          Buffer.from(command.input.Body as Uint8Array).equals(flow.previousCandidate))
        throw new Error("restore failed");
      return sendNormally(...args);
    });
    flow.hook.mockResolvedValue({ ok: false, status: 503 });

    await expect(requestEditorialRelease(requestInput)).rejects.toMatchObject({ code: "FEED_DEPLOY_HOOK_REJECTED" });

    expect(flow.release).toMatchObject({ status: "awaiting_confirmation", error_code: "CANDIDATE_RESTORE_UNCERTAIN" });
  });

  it.each(["awaiting_confirmation", "building"])("only an explicit retry redispatches %s, without rewriting the snapshot", async (status) => {
    const flow = setupReleaseFlow(status);
    await expect(requestEditorialRelease(requestInput)).resolves.toMatchObject({ duplicate: true });
    expect(flow.fetchMock).not.toHaveBeenCalled();

    await expect(retryEditorialRelease("test-release", "test-admin")).resolves.toMatchObject({ status: "awaiting_confirmation", duplicate: false });

    expect(flow.marker).toHaveBeenCalledTimes(1);
    expect(flow.hook).toHaveBeenCalledTimes(1);
    expect(flow.marker.mock.invocationCallOrder[0]).toBeLessThan(flow.hook.mock.invocationCallOrder[0]!);
    expect(flow.send.mock.calls.every(([command]) => command instanceof GetObjectCommand)).toBe(true);
  });

  it("reconciles an already-live uncertain release without calling the hook", async () => {
    const flow = setupReleaseFlow("awaiting_confirmation");
    flow.marker.mockResolvedValue({ ok: true, status: 200, json: async () => flow.markerFor(flow.release) });

    await expect(retryEditorialRelease("test-release", "test-admin")).resolves.toMatchObject({ status: "live", duplicate: true });

    expect(flow.hook).not.toHaveBeenCalled();
    expect(flow.send).not.toHaveBeenCalled();
    expect(flow.release.status).toBe("live");
  });

  it("retries an actual timed-out attempt using its exact stored candidate and bypass header", async () => {
    mocks.bypassSecret = "server-only-test-secret";
    const flow = setupReleaseFlow();
    flow.hook.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    await expect(requestEditorialRelease(requestInput)).rejects.toMatchObject({ code: "FEED_RELEASE_FAILED" });
    const storedCandidate = flow.objects.get(candidateKey);
    flow.send.mockClear();

    await expect(retryEditorialRelease("test-release", "test-admin")).resolves.toMatchObject({ status: "awaiting_confirmation", duplicate: false });

    expect(flow.hook).toHaveBeenCalledTimes(2);
    expect(flow.objects.get(candidateKey)).toEqual(storedCandidate);
    expect(flow.send.mock.calls.every(([command]) => command instanceof GetObjectCommand)).toBe(true);
    expect(new Headers(flow.marker.mock.lastCall![1].headers).get("x-vercel-protection-bypass")).toBe("server-only-test-secret");
  });

  it.each(["failed", "preparing", "awaiting_confirmation", "building"])("blocks a superseded %s retry before any external operation", async (status) => {
    const flow = setupReleaseFlow(status);
    flow.state.newer = true;

    await expect(retryEditorialRelease("test-release", "test-admin")).rejects.toMatchObject({ code: "FEED_RELEASE_SUPERSEDED" });

    expect(flow.release.status).toBe(status);
    expect(flow.fetchMock).not.toHaveBeenCalled();
    expect(flow.send).not.toHaveBeenCalled();
  });

  it("does not reconcile over any newer release, even one not live yet", async () => {
    const flow = setupReleaseFlow("awaiting_confirmation");
    flow.state.newer = true;
    flow.marker.mockResolvedValue({ ok: true, status: 200, json: async () => flow.markerFor(flow.release) });

    await expect(checkEditorialRelease("test-release")).resolves.toMatchObject({ live: false });

    expect(flow.release.status).toBe("awaiting_confirmation");
    expect(mocks.query).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE editorial_post"), expect.anything());
    expect(mocks.query).toHaveBeenCalledWith(
      "SELECT id FROM editorial_release WHERE namespace=$1 AND sequence>$2 LIMIT 1",
      ["test/feed", flow.release.sequence],
    );
  });

  it.each([401, 503])("blocks uncertain retries when marker HTTP %s prevents verification", async (status) => {
    const flow = setupReleaseFlow("awaiting_confirmation");
    flow.marker.mockResolvedValue({ ok: false, status });

    await expect(retryEditorialRelease("test-release", "test-admin")).rejects.toMatchObject({ code: "FEED_LIVE_RELEASE_UNAVAILABLE" });

    expect(flow.release.status).toBe("awaiting_confirmation");
    expect(flow.hook).not.toHaveBeenCalled();
    expect(flow.send).not.toHaveBeenCalled();
  });

  it("does not retry on a marker timeout", async () => {
    const flow = setupReleaseFlow("awaiting_confirmation");
    flow.marker.mockRejectedValue(new DOMException("timed out", "TimeoutError"));

    await expect(retryEditorialRelease("test-release", "test-admin")).rejects.toMatchObject({ code: "FEED_LIVE_RELEASE_UNAVAILABLE" });

    expect(flow.release.status).toBe("awaiting_confirmation");
    expect(flow.hook).not.toHaveBeenCalled();
  });

  it("blocks a mismatching live marker", async () => {
    const flow = setupReleaseFlow("awaiting_confirmation");
    flow.marker.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...flow.markerFor(flow.live), namespace: "other/feed" }) });

    await expect(retryEditorialRelease("test-release", "test-admin")).rejects.toMatchObject({ code: "FEED_LIVE_RELEASE_MISMATCH" });

    expect(flow.hook).not.toHaveBeenCalled();
    expect(flow.send).not.toHaveBeenCalled();
  });

  it.each(["missing", "other-release", "wrong-hash", "wrong-key"])("blocks a %s candidate without overwriting it", async (problem) => {
    const flow = setupReleaseFlow("awaiting_confirmation");
    const candidate = JSON.parse(flow.currentCandidate().toString());
    if (problem === "missing") flow.objects.delete(candidateKey);
    else {
      if (problem === "other-release") candidate.releaseId = "other-release";
      if (problem === "wrong-hash") candidate.manifestSha256 = "wrong-hash";
      if (problem === "wrong-key") candidate.manifestKey = "other/manifest.json";
      flow.objects.set(candidateKey, Buffer.from(JSON.stringify(candidate)));
    }

    await expect(retryEditorialRelease("test-release", "test-admin")).rejects.toMatchObject({ code: "FEED_CANDIDATE_MISMATCH" });

    expect(flow.release.status).toBe("awaiting_confirmation");
    expect(flow.hook).not.toHaveBeenCalled();
    expect(flow.send.mock.calls.every(([command]) => command instanceof GetObjectCommand)).toBe(true);
  });

  it("allows a first-release uncertain retry after confirming the marker is absent", async () => {
    const flow = setupReleaseFlow("awaiting_confirmation");
    flow.state.live = false;
    flow.marker.mockResolvedValue({ ok: false, status: 404 });

    await expect(retryEditorialRelease("test-release", "test-admin")).resolves.toMatchObject({ status: "awaiting_confirmation" });
    expect(flow.hook).toHaveBeenCalledTimes(1);
  });

  it("does not erase earlier uncertainty when the retried hook explicitly rejects", async () => {
    const flow = setupReleaseFlow("awaiting_confirmation");
    flow.hook.mockResolvedValue({ ok: false, status: 503 });

    await expect(retryEditorialRelease("test-release", "test-admin")).rejects.toMatchObject({ code: "FEED_DEPLOY_HOOK_REJECTED" });

    expect(flow.release).toMatchObject({ status: "awaiting_confirmation", error_code: "DEPLOY_HOOK_UNCERTAIN" });
    expect(flow.objects.get(candidateKey)).toEqual(flow.currentCandidate());
  });

  it.each([undefined, "server-only-test-secret"])("uses the optional bypass header only for both marker paths: %s", async (secret) => {
    mocks.bypassSecret = secret;
    const flow = setupReleaseFlow();
    await requestEditorialRelease(requestInput);
    flow.marker.mockResolvedValue({ ok: true, status: 200, json: async () => flow.markerFor(flow.release) });
    await checkEditorialRelease("test-release");

    expect(flow.marker).toHaveBeenCalledTimes(2);
    for (const [url, options] of flow.marker.mock.calls) {
      const headers = new Headers(options.headers);
      expect(headers.get("x-vercel-protection-bypass")).toBe(secret ?? null);
      expect(headers.get("Cache-Control")).toBe("no-cache");
      if (secret) expect(url).not.toContain(secret);
    }
    for (const [url, options] of flow.hook.mock.calls) {
      expect(new Headers(options.headers).has("x-vercel-protection-bypass")).toBe(false);
      if (secret) expect(url).not.toContain(secret);
    }
    for (const bytes of flow.objects.values()) {
      expect(bytes.toString()).not.toContain("server-only-test-secret");
    }
  });
});
