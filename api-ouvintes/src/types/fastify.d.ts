import "@fastify/jwt";
import type { AuthorizationContext } from "../services/authorization-service.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      role: "admin" | "viewer";
      name: string;
      username: string;
      sid: string;
      authzVersion: number;
    };
    user: {
      sub: string;
      role: "admin" | "viewer";
      name: string;
      username: string;
      sid: string;
      authzVersion: number;
    };
  }
}

declare module "fastify" {
  interface FastifyRequest {
    authz: AuthorizationContext | null;
  }
}
