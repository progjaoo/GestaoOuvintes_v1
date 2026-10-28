import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../src/lib/errors.js";

const mocks = vi.hoisted(() => ({
  env: { FEED_ENABLED: false },
  authenticate: vi.fn(),
  permission: vi.fn(),
  service: vi.fn(),
}));

vi.mock("../../src/config/env.js", () => ({ env: mocks.env }));
vi.mock("../../src/plugins/auth.js", () => ({
  requireAuthentication: mocks.authenticate,
  requirePermission: (permission: string) => async () => mocks.permission(permission),
}));
vi.mock("../../src/services/editorial/media-service.js", () => ({
  completeEditorialUpload: mocks.service,
  createEditorialUpload: mocks.service,
  getEditorialMediaPreview: mocks.service,
  listEditorialMedia: mocks.service,
}));
vi.mock("../../src/services/editorial/release-service.js", () => ({
  checkEditorialRelease: mocks.service,
  getEditorialRelease: mocks.service,
  requestEditorialRelease: mocks.service,
  retryEditorialRelease: mocks.service,
}));
vi.mock("../../src/services/editorial/post-service.js", () => ({
  createEditorialCategory: mocks.service,
  getEditorialPost: mocks.service,
  listEditorialCategories: mocks.service,
  listEditorialPosts: mocks.service,
  saveEditorialDraft: mocks.service,
  updateEditorialCategory: mocks.service,
}));

import { adminFeedRoutes } from "../../src/routes/admin-feed.js";

const id = "6b774ae8-a78f-4b1e-8d98-1a69ca3c4ab1";
const routes = [
  { method: "GET", path: "/categories" },
  { method: "POST", path: "/categories" },
  { method: "PATCH", path: `/categories/${id}` },
  { method: "GET", path: "/posts" },
  { method: "GET", path: `/posts/${id}` },
  { method: "POST", path: "/posts" },
  { method: "PATCH", path: `/posts/${id}` },
  { method: "GET", path: "/assets" },
  { method: "POST", path: "/assets/uploads" },
  { method: "POST", path: `/assets/${id}/complete` },
  { method: "GET", path: `/assets/${id}/preview` },
  { method: "POST", path: `/posts/${id}/publish` },
  { method: "POST", path: `/posts/${id}/archive` },
  { method: "GET", path: `/releases/${id}` },
  { method: "POST", path: `/releases/${id}/check` },
  { method: "POST", path: `/releases/${id}/retry` },
] as const;

describe("admin Feed route gate", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.env.FEED_ENABLED = false;
    mocks.authenticate.mockImplementation(async (request: FastifyRequest) => {
      if (request.headers.authorization !== "Bearer synthetic-test-token") {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required.");
      }
    });
    mocks.service.mockResolvedValue([]);
    app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof AppError) {
        return reply.code(error.statusCode).send({ code: error.code });
      }
      return reply.send(error);
    });
    app.get("/health", async () => ({ status: "ok" }));
    await app.register(adminFeedRoutes, { prefix: "/api/admin/feed" });
  });

  afterEach(async () => app.close());

  it.each(routes)("returns 503 before permissions or services for $method $path when disabled", async ({ method, path }) => {
    const response = await app.inject({
      method,
      url: `/api/admin/feed${path}`,
      headers: { authorization: "Bearer synthetic-test-token" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: "FEED_DISABLED" });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers.vary).toBe("Authorization");
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it.each([false, true])("retains authentication when FEED_ENABLED=%s", async (enabled) => {
    mocks.env.FEED_ENABLED = enabled;
    const response = await app.inject({ method: "GET", url: "/api/admin/feed/categories" });
    expect(response.statusCode).toBe(401);
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it("allows authenticated, permitted requests when enabled", async () => {
    mocks.env.FEED_ENABLED = true;
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/feed/categories",
      headers: { authorization: "Bearer synthetic-test-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
    expect(mocks.permission).toHaveBeenCalledExactlyOnceWith("feed.read");
    expect(mocks.service).toHaveBeenCalledOnce();
  });

  it("retains RBAC denial when enabled", async () => {
    mocks.env.FEED_ENABLED = true;
    mocks.permission.mockRejectedValue(new AppError(403, "INSUFFICIENT_PERMISSION", "Permission required."));
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/feed/categories",
      headers: { authorization: "Bearer synthetic-test-token" },
    });
    expect(response.statusCode).toBe(403);
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it("does not gate unrelated routes", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.permission).not.toHaveBeenCalled();
  });
});
