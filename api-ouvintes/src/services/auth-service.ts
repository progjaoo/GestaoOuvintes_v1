import argon2 from "argon2";
import { count, eq } from "drizzle-orm";
import { db } from "../database/client.js";
import { adminUsers } from "../database/schema.js";
import { AppError } from "../lib/errors.js";

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

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role as "admin" | "viewer",
  };
}

export async function authenticateAdmin(username: string, password: string) {
  const normalizedUsername = username.trim().toLocaleLowerCase("pt-BR");
  const user = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.username, normalizedUsername),
  });

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
    role: user.role as "admin" | "viewer",
  };
}

export async function getActiveAdmin(id: string) {
  const user = await db.query.adminUsers.findFirst({
    columns: {
      id: true,
      name: true,
      username: true,
      role: true,
      active: true,
      lastLoginAt: true,
    },
    where: eq(adminUsers.id, id),
  });

  if (!user?.active) {
    throw new AppError(401, "ADMIN_INACTIVE", "Sessao invalida.");
  }

  return user;
}
