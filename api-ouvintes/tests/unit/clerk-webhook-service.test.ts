import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyClerkWebhookRequest } from "../../src/routes/clerk-webhooks.js";
import {
  getClerkWebhookEventDate,
  hashClerkWebhookPayload,
} from "../../src/services/clerk-webhook-service.js";

const secret = `whsec_${Buffer.from("clerk-webhook-test-secret").toString("base64")}`;

function signedHeaders(body: string, eventId = "msg_test_001") {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(`${eventId}.${timestamp}.${body}`)
    .digest("base64");

  return new Headers({
    "content-type": "application/json",
    "svix-id": eventId,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
  });
}

describe("Clerk webhook verification", () => {
  it("verifies the original signed body", async () => {
    const body = JSON.stringify({
      type: "user.updated",
      data: { id: "user_test_001", updated_at: Date.now() },
    });

    const event = await verifyClerkWebhookRequest(
      Buffer.from(body),
      signedHeaders(body),
      secret,
    );

    expect(event.type).toBe("user.updated");
    expect(event.data.id).toBe("user_test_001");
  });

  it("rejects a body changed after signing", async () => {
    const originalBody = JSON.stringify({ type: "user.updated", data: { id: "user_test_002" } });

    await expect(
      verifyClerkWebhookRequest(
        Buffer.from(`${originalBody} `),
        signedHeaders(originalBody),
        secret,
      ),
    ).rejects.toThrow();
  });

  it("rejects a request without the signed headers", async () => {
    await expect(
      verifyClerkWebhookRequest(
        Buffer.from(JSON.stringify({ type: "user.updated", data: { id: "user_test_003" } })),
        new Headers({ "content-type": "application/json" }),
        secret,
      ),
    ).rejects.toThrow();
  });

  it("hashes the exact body used for idempotency", () => {
    const first = hashClerkWebhookPayload(Buffer.from("{\"a\":1}"));
    const second = hashClerkWebhookPayload(Buffer.from("{ \"a\": 1 }"));

    expect(first).toHaveLength(64);
    expect(first).not.toBe(second);
  });

  it("uses the verified user timestamp before the envelope fallback", () => {
    const updatedAt = Date.now() - 1_000;
    const result = getClerkWebhookEventDate(
      "user.updated",
      { updated_at: updatedAt },
      Math.floor(Date.now() / 1000),
    );

    expect(result.getTime()).toBe(updatedAt);
  });
});
