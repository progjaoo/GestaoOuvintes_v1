import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";

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
