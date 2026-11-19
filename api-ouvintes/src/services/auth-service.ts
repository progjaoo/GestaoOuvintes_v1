import argon2 from "argon2";
import { count, eq } from "drizzle-orm";
import { db, pool } from "../database/client.js";
import { adminUsers } from "../database/schema.js";
import { AppError } from "../lib/errors.js";

export function jwtExpiresAt(expiresIn: string, now = new Date()) {
  const match = expiresIn.trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!match) throw new Error("JWT_EXPIRES_IN precisa usar formato s, m, h ou d.");
  const value = Number(match[1]);
  const multiplier = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
    match[2]!.toLowerCase() as "s" | "m" | "h" | "d"
  ];
  return new Date(now.getTime() + value * multiplier);
}

export async function canBootstrapAdmin(): Promise<boolean> {
  const [result] = await db.select({ value: count() }).from(adminUsers);
  return (result?.value ?? 0) === 0;
}

export async function bootstrapFirstAdmin(input: {
  name: string;
  username: string;
  password: string;
}) {
  const canBootstrap = await canBootstrapAdmin();

  if (!canBootstrap) {
    throw new AppError(
      409,
      "ADMIN_ALREADY_EXISTS",
      "O primeiro administrador ja foi configurado.",
    );
  }

  const normalizedUsername = input.username.trim().toLocaleLowerCase("pt-BR");
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
  });

  const [user] = await db
    .insert(adminUsers)
    .values({
      name: input.name.trim(),
      username: normalizedUsername,
      passwordHash,
      role: "admin",
      active: true,
    })
    .returning({
      id: adminUsers.id,
      name: adminUsers.name,
      username: adminUsers.username,
      role: adminUsers.role,
    });

  if (!user) {
    throw new AppError(500, "ADMIN_BOOTSTRAP_FAILED", "Falha ao criar administrador.");
  }

  await pool.query(
    "INSERT INTO admin_user_role (admin_user_id, role_id) " +
      "SELECT $1, id FROM role WHERE key = 'admin' ON CONFLICT DO NOTHING",
    [user.id],
  );

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role as "admin" | "viewer",
  };
}

export async function authenticateAdmin(identifier: string, password: string) {
  const normalizedIdentifier = identifier.trim().toLocaleLowerCase("pt-BR");
  let user = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.username, normalizedIdentifier),
  });
  if (!user && normalizedIdentifier.includes("@")) {
    user = await db.query.adminUsers.findFirst({
      where: eq(adminUsers.emailNormalized, normalizedIdentifier),
    });
    if (user?.emailVerifiedAt === null) user = undefined;
  }

  const passwordMatches =
    user?.active === true ? await argon2.verify(user.passwordHash, password) : false;

  if (!user || !passwordMatches) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Usuario ou senha invalidos.");
  }

  await db
    .update(adminUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(adminUsers.id, user.id));

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    role: user.role as "admin" | "viewer",
    isSuperAdmin: user.isSuperAdmin,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function verifyAdminPassword(adminUserId: string, password: string) {
  const user = await db.query.adminUsers.findFirst({
    columns: { passwordHash: true, active: true },
    where: eq(adminUsers.id, adminUserId),
  });
  if (!user?.active) return false;
  return argon2.verify(user.passwordHash, password);
}

export async function getActiveAdmin(id: string, permissions: string[]) {
  const user = await db.query.adminUsers.findFirst({
    columns: {
      id: true,
      name: true,
      username: true,
      email: true,
      emailVerifiedAt: true,
      role: true,
      active: true,
      isSuperAdmin: true,
      mustChangePassword: true,
      phone: true,
      lastLoginAt: true,
    },
    where: eq(adminUsers.id, id),
  });

  if (!user?.active) {
    throw new AppError(401, "ADMIN_INACTIVE", "Sessao invalida.");
  }

  return { ...user, permissions };
}
