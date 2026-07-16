import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { db, pool } from "./client.js";
import { adminUsers, campaigns } from "./schema.js";

async function seed(): Promise<void> {
  const username = env.ADMIN_INITIAL_USERNAME.trim().toLocaleLowerCase("pt-BR");
  const existingAdmin = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.username, username),
  });

  if (!existingAdmin) {
    const passwordHash = await argon2.hash(env.ADMIN_INITIAL_PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    await db.insert(adminUsers).values({
      name: env.ADMIN_INITIAL_NAME.trim(),
      username,
      passwordHash,
      role: "admin",
      active: true,
    });
    console.info("Usuario administrativo inicial criado.");
  }

  const existingCampaign = await db.query.campaigns.findFirst({
    where: eq(campaigns.slug, env.CAMPAIGN_SLUG),
  });

  if (!existingCampaign) {
    await db.insert(campaigns).values({
      slug: env.CAMPAIGN_SLUG,
      name: env.CAMPAIGN_NAME,
      title: "Faca parte da historia da Radio 88 FM",
      description: "Cadastre-se para participar desta nova fase da Radio 88 FM.",
      status: "active",
      startsAt: new Date(env.CAMPAIGN_STARTS_AT),
      endsAt: env.CAMPAIGN_ENDS_AT ? new Date(env.CAMPAIGN_ENDS_AT) : null,
      privacyNoticeVersion: env.PRIVACY_NOTICE_VERSION,
      privacyNoticeUrl: env.PRIVACY_NOTICE_URL,
    });
    console.info("Campanha inicial criada.");
  }
}

seed()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("Falha ao executar seed.", error);
    await pool.end();
    process.exitCode = 1;
  });
