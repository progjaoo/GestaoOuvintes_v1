import { z } from "zod";

const uuid = z.string().uuid();
const phone = z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/).nullable().optional();

export const adminUserListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(["active", "inactive", "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const createAdminUserSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(320),
  phone,
  roleIds: z.array(uuid).min(1).max(20),
});

export const updateAdminUserSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().email().max(320).optional(),
  phone,
  active: z.boolean().optional(),
  roleIds: z.array(uuid).min(1).max(20).optional(),
  version: z.number().int().positive(),
}).refine((input) => Object.keys(input).some((key) => key !== "version"), {
  message: "Informe ao menos um campo para atualizar.",
});

export const adminPermissionOverrideSchema = z.object({
  overrides: z.array(z.object({
    permissionKey: z.string().trim().min(3).max(120),
    effect: z.enum(["ALLOW", "DENY"]),
    scopeType: z.enum(["global", "own", "participation", "department"]).optional(),
    departmentId: uuid.nullable().optional(),
    reason: z.string().trim().min(5).max(500),
  })).max(100),
});

export const passwordResetAdminSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

export const createRoleSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_-]{2,79}$/),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  grants: z.array(z.object({
    permissionKey: z.string().trim().min(3).max(120),
    scopeType: z.enum(["global", "own", "participation", "department"]),
    departmentId: uuid.nullable().optional(),
  })).max(200),
});

export const updateRoleSchema = createRoleSchema.omit({ key: true }).extend({
  version: z.number().int().positive(),
});
