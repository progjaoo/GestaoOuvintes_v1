import { verifyWebhook } from "@clerk/backend/webhooks";
import { Readable } from "node:stream";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import {
  getClerkWebhookEventDate,
  getClerkWebhookUserId,
  hashClerkWebhookPayload,
  processClerkWebhook,
} from "../services/clerk-webhook-service.js";

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : undefined;
}

function requiredHeader(request: FastifyRequest, ...names: string[]): string {
  for (const name of names) {
    const value = headerValue(request, name);
    if (value?.trim()) return value.trim();
  }
  throw new AppError(400, "CLERK_WEBHOOK_INVALID", "Webhook Clerk invalido.");
}

function timestampSeconds(request: FastifyRequest): number | undefined {
  const value = headerValue(request, "svix-timestamp") ?? headerValue(request, "webhook-timestamp");
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requestHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(","));
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

export async function verifyClerkWebhookRequest(
  rawBody: Buffer,
  headers: Headers,
  signingSecret: string,
) {
  const standardRequest = new Request("http://localhost/api/webhooks/clerk", {
    method: "POST",
    headers,
    body: rawBody.toString("utf8"),
  });
  return verifyWebhook(standardRequest, { signingSecret });
}

async function captureRawBody(
  request: FastifyRequest,
  _reply: FastifyReply,
  payload: NodeJS.ReadableStream,
): Promise<Readable> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of payload as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > env.CLERK_WEBHOOK_BODY_LIMIT_BYTES) {
      throw new AppError(413, "CLERK_WEBHOOK_BODY_TOO_LARGE", "Payload do webhook muito grande.");
    }
    chunks.push(buffer);
  }

  request.rawBody = Buffer.concat(chunks);
  return Readable.from([request.rawBody]);
}

export const clerkWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.decorateRequest("rawBody", undefined);
  app.addHook("preParsing", captureRawBody);

  app.post(
    "/clerk",
    {
      bodyLimit: env.CLERK_WEBHOOK_BODY_LIMIT_BYTES,
      config: {
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
        },
      },
    },
    async (request) => {
      if (!env.CLERK_WEBHOOK_SIGNING_SECRET) {
        throw new AppError(
          503,
          "CLERK_WEBHOOK_NOT_CONFIGURED",
          "Webhook Clerk nao configurado.",
        );
      }

      const signingSecret = env.CLERK_WEBHOOK_SIGNING_SECRET;

      const rawBody = request.rawBody;
      if (!rawBody) {
        throw new AppError(400, "CLERK_WEBHOOK_BODY_MISSING", "Payload do webhook ausente.");
      }

      const eventId = requiredHeader(request, "svix-id", "webhook-id");
      const event = await (async () => {
        try {
          return await verifyClerkWebhookRequest(
            rawBody,
            requestHeaders(request),
            signingSecret,
          );
        } catch {
          throw new AppError(
            400,
            "CLERK_WEBHOOK_SIGNATURE_INVALID",
            "Webhook Clerk invalido.",
          );
        }
      })();

      const payloadHash = hashClerkWebhookPayload(rawBody);
      const occurredAt = getClerkWebhookEventDate(
        event.type,
        event.data,
        timestampSeconds(request),
      );

      return processClerkWebhook({
        eventId,
        eventType: event.type,
        clerkUserId: getClerkWebhookUserId(event.data),
        instanceKey: env.CLERK_WEBHOOK_INSTANCE_KEY,
        payloadHash,
        occurredAt,
        data: event.data,
      });
    },
  );
};
