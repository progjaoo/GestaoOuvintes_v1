import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  resendConfigured: true,
  RESEND_API_KEY: "test-resend-key",
  RESEND_FROM_EMAIL: "Gestao Radio 88 <acessos@example.test>",
  ADMIN_APP_BASE_URL: "https://painel.example.test",
}));

vi.mock("../../src/config/env.js", () => ({ env: mockEnv }));

import { sendIdentityEmail } from "../../src/services/resend-email-service.js";

describe("Resend identity email adapter", () => {
  beforeEach(() => {
    mockEnv.resendConfigured = true;
    mockEnv.RESEND_API_KEY = "test-resend-key";
    mockEnv.RESEND_FROM_EMAIL = "Gestao Radio 88 <acessos@example.test>";
    mockEnv.ADMIN_APP_BASE_URL = "https://painel.example.test";
  });

  it("does not attempt delivery when Resend is not fully configured", async () => {
    mockEnv.resendConfigured = false;
    const fetcher = vi.fn();

    await expect(sendIdentityEmail({
      kind: "invite", to: "person@example.test", name: "Pessoa", token: "opaque-token",
      idempotencyKey: "identity/test",
    }, fetcher)).resolves.toEqual({ status: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends a single-use link with the token in the URL fragment, not the query string", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 202 }));
    const result = await sendIdentityEmail({
      kind: "invite", to: "person@example.test", name: "Pessoa <Admin>", token: "opaque-secret-token",
      idempotencyKey: "identity/invite-1",
    }, fetcher);

    expect(result).toEqual({ status: "sent" });
    const [, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(request.headers).toMatchObject({ Authorization: "Bearer test-resend-key", "Idempotency-Key": "identity/invite-1" });
    const body = JSON.parse(String(request.body)) as { to: string[]; html: string; text: string };
    expect(body.to).toEqual(["person@example.test"]);
    expect(body.html).toContain("#token=opaque-secret-token");
    expect(body.html).not.toContain("?token=");
    expect(body.html).toContain("Pessoa &lt;Admin&gt;");
    expect(body.text).toContain("expira em 24 horas");
  });

  it("does not expose a provider response body on delivery failure", async () => {
    const fetcher = vi.fn(async () => new Response("private-provider-detail", { status: 503 }));

    await expect(sendIdentityEmail({
      kind: "password_reset", to: "person@example.test", name: "Pessoa", token: "opaque-token",
      idempotencyKey: "identity/reset-1",
    }, fetcher)).resolves.toEqual({ status: "failed", code: "http_503" });
  });

  it("marks timeout as uncertain instead of encouraging blind resend", async () => {
    const timeout = Object.assign(new Error("request timeout"), { name: "TimeoutError" });
    const fetcher = vi.fn(async () => { throw timeout; });

    await expect(sendIdentityEmail({
      kind: "email_verification", to: "person@example.test", name: "Pessoa", token: "opaque-token",
      idempotencyKey: "identity/verify-1",
    }, fetcher)).resolves.toEqual({ status: "uncertain", code: "timeout" });
  });
});
