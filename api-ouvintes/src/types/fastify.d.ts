import "@fastify/jwt";
import type { ListenerAuthContext } from "../services/clerk-identity-service.js";
import type { TenantContext } from "../services/tenant-service.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      role: "admin" | "viewer";
      name: string;
      username: string;
      tenantId?: string;
      membershipId?: string | null;
      roleKeys?: string[];
      permissionKeys?: string[];
    };
    user: {
      sub: string;
      role: "admin" | "viewer";
      name: string;
      username: string;
      tenantId?: string;
      membershipId?: string | null;
      roleKeys?: string[];
      permissionKeys?: string[];
    };
  }
}

declare module "fastify" {
  interface FastifyRequest {
    tenant?: TenantContext;
    listener?: ListenerAuthContext;
    rawBody?: Buffer;
  }
}
