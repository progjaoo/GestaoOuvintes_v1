import type { FastifyPluginAsync } from "fastify";
import { requireAdminRole, requireAuthentication } from "../plugins/auth.js";
import { publishPublicConfigSnapshot } from "../services/public-config-snapshot.js";
import { setPublicConfigSyncHeaders } from "../services/public-config-sync.js";

export const adminPublicConfigRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuthentication);

  app.post("/republish", { preHandler: requireAdminRole }, async (request, reply) => {
    try {
      const result = await publishPublicConfigSnapshot();
      setPublicConfigSyncHeaders(reply, result.syncStatus, result.revision);
      return result;
    } catch (error) {
      request.log.warn(
        {
          event: "public_config_snapshot_republish_failed",
          errorName: error instanceof Error ? error.name : typeof error,
        },
        "Falha ao republicar configuracao publica.",
      );
      setPublicConfigSyncHeaders(reply, "pending");
      return reply.code(502).send({ syncStatus: "pending", revision: null });
    }
  });
};
