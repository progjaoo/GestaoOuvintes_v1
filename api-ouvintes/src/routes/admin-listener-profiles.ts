import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { requireAuthentication, requirePermission } from "../plugins/auth.js";
import {
  listenerProfileIdParamsSchema,
  listenerProfileListQuerySchema,
} from "../schemas/listener-crm.js";
import {
  getListenerProfile,
  listListenerProfiles,
  listProfileActivity,
  listProfileConsents,
  listProfileParticipations,
} from "../services/listener-crm-service.js";
import { pool } from "../database/client.js";
import { AppError } from "../lib/errors.js";

function canReadSensitive(request: FastifyRequest): boolean {
  return (
    request.user.permissionKeys?.includes("listener.phone.read") === true ||
    (env.LEGACY_ADMIN_RBAC_FALLBACK && request.user.role === "admin")
  );
}

function assertCrmEnabled() {
  if (!env.LISTENER_CRM_PROFILES_ENABLED) {
    throw new AppError(
      404,
      "CRM_PROFILES_DISABLED",
      "O CRM de ouvintes esta temporariamente indisponivel.",
    );
  }
}

async function auditProfileView(
  request: FastifyRequest,
  resourceId: string,
  action: string,
) {
  const adminUserResult = await pool.query<{ id: string }>(
    "select id from admin_user where clerk_user_id = $1 or id::text = $1 limit 1",
    [request.user.sub],
  );
  await pool.query(
    "insert into admin_audit_log " +
      "(admin_user_id, action, resource_type, resource_id, metadata) " +
      "values ($1, $2, $3, $4, $5::jsonb)",
    [
      adminUserResult.rows[0]?.id ?? null,
      action,
      "listener_profile",
      resourceId,
      JSON.stringify({ tenantId: request.tenant?.tenantId }),
    ],
  );
}

export const adminListenerProfileRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuthentication);

  app.get(
    "/",
    { preHandler: requirePermission("listener.read") },
    async (request) => {
      assertCrmEnabled();
      const filters = listenerProfileListQuerySchema.parse(request.query);
      return listListenerProfiles(
        filters,
        request.tenant!.tenantId,
        canReadSensitive(request),
      );
    },
  );

  app.get(
    "/:id",
    { preHandler: requirePermission("listener.read") },
    async (request) => {
      assertCrmEnabled();
      const { id } = listenerProfileIdParamsSchema.parse(request.params);
      await auditProfileView(request, id, "listener_profile.view");
      return {
        profile: await getListenerProfile(
          id,
          request.tenant!.tenantId,
          canReadSensitive(request),
        ),
      };
    },
  );

  app.get(
    "/:id/participations",
    { preHandler: requirePermission("listener.read") },
    async (request) => {
      assertCrmEnabled();
      const { id } = listenerProfileIdParamsSchema.parse(request.params);
      await auditProfileView(request, id, "listener_profile.participations_view");
      return listProfileParticipations(id, request.tenant!.tenantId);
    },
  );

  app.get(
    "/:id/consents",
    { preHandler: requirePermission("listener.read") },
    async (request) => {
      assertCrmEnabled();
      const { id } = listenerProfileIdParamsSchema.parse(request.params);
      await auditProfileView(request, id, "listener_profile.consents_view");
      return listProfileConsents(id, request.tenant!.tenantId);
    },
  );

  app.get(
    "/:id/activity",
    { preHandler: requirePermission("listener.read") },
    async (request) => {
      assertCrmEnabled();
      const { id } = listenerProfileIdParamsSchema.parse(request.params);
      await auditProfileView(request, id, "listener_profile.activity_view");
      return listProfileActivity(id, request.tenant!.tenantId);
    },
  );
};
