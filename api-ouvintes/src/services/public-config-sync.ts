import type { FastifyReply, FastifyRequest } from "fastify";
import { publishPublicConfigSnapshot } from "./public-config-snapshot.js";

export type PublicConfigSyncStatus = "published" | "pending" | "disabled";

export async function syncPublicConfigAfterMutation(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  let status: PublicConfigSyncStatus = "disabled";
  let revision: string | null = null;

  try {
    const result = await publishPublicConfigSnapshot();
    status = result.syncStatus;
    revision = result.revision;
  } catch (error) {
    status = "pending";
    request.log.warn(
      {
        event: "public_config_snapshot_publish_failed",
        errorName: error instanceof Error ? error.name : typeof error,
      },
      "A alteracao administrativa foi salva, mas a configuracao publica aguarda republicacao.",
    );
  }

  reply.header("X-Public-Config-Sync", status);
  if (revision) reply.header("X-Public-Config-Revision", revision);
  return { syncStatus: status, revision };
}

export function setPublicConfigSyncHeaders(
  reply: FastifyReply,
  status: PublicConfigSyncStatus,
  revision?: string | null,
) {
  reply.header("X-Public-Config-Sync", status);
  if (revision) reply.header("X-Public-Config-Revision", revision);
}
