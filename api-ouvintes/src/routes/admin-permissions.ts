import type { FastifyPluginAsync } from "fastify";
import { pool } from "../database/client.js";
import { requireAuthentication, requirePermission } from "../plugins/auth.js";
import { hasGlobalPermission } from "../services/authorization-service.js";
import { AppError } from "../lib/errors.js";

export const adminPermissionRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/",
    { preHandler: [requireAuthentication, requirePermission("permission.read")] },
    async (request) => {
      if (!hasGlobalPermission(request.authz, "permission.read")) {
        throw new AppError(403, "GLOBAL_SCOPE_REQUIRED", "Esta operacao exige permissao global para consultar o catalogo.");
      }
      const result = await pool.query(
        `SELECT p.key, p.description,
                COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
                  'roleId', r.id, 'roleKey', r.key, 'roleName', r.name,
                  'scopeType', rps.scope_type, 'departmentId', rps.department_id
                )) FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) AS role_grants
         FROM permission p
         LEFT JOIN role_permission rp ON rp.permission_id = p.id
         LEFT JOIN role r ON r.id = rp.role_id
         LEFT JOIN role_permission_scope rps
           ON rps.role_id = rp.role_id AND rps.permission_id = rp.permission_id
         GROUP BY p.id
         ORDER BY p.key`,
      );
      return { items: result.rows };
    },
  );
};
