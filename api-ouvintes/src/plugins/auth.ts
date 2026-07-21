import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import { pool } from "../database/client.js";

export async function requireAuthentication(request: FastifyRequest) {
  await request.jwtVerify();
}

export function requireAdminRole(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: (error?: Error) => void,
) {
  if (request.user.role !== "admin") {
    done(new AppError(403, "INSUFFICIENT_PERMISSION", "Permissao insuficiente."));
    return;
  }

  done();
}

export function requirePermission(permissionKey: string) {
  return async function permissionPreHandler(request: FastifyRequest) {
    const result = await pool.query(
      `SELECT 1
       FROM admin_user_role aur
       JOIN role_permission rp ON rp.role_id = aur.role_id
       JOIN permission p ON p.id = rp.permission_id
       WHERE aur.admin_user_id = $1 AND p.key = $2
       LIMIT 1`,
      [request.user.sub, permissionKey],
    );

    if (!result.rowCount) {
      throw new AppError(403, "INSUFFICIENT_PERMISSION", "Permissao insuficiente.");
    }
  };
}
