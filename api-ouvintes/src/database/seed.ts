import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { db, pool } from "./client.js";
import {
  adminUsers,
  campaigns,
  campaignPlacements,
  roles,
} from "./schema.js";

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

  const admin = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.username, username),
  });
  if (!admin) {
    throw new Error("Usuario administrativo inicial nao foi encontrado apos o seed.");
  }

  const legacyRole = await db.query.roles.findFirst({
    where: eq(roles.key, admin.role),
  });
  if (!legacyRole) {
    throw new Error(`Papel legado '${admin.role}' nao foi criado pelas migrations.`);
  }

  await pool.query(
    "INSERT INTO admin_user_role (admin_user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [admin.id, legacyRole.id],
  );

  const existingCampaign = await db.query.campaigns.findFirst({
    where: eq(campaigns.slug, env.CAMPAIGN_SLUG),
  });

  if (!existingCampaign) {
    const [campaign] = await db.insert(campaigns).values({
      slug: env.CAMPAIGN_SLUG,
      name: env.CAMPAIGN_NAME,
      title: "Faca parte da historia da Radio 88 FM",
      description: "Cadastre-se para participar desta nova fase da Radio 88 FM.",
      status: "active",
      type: "registration",
      startsAt: new Date(env.CAMPAIGN_STARTS_AT),
      endsAt: env.CAMPAIGN_ENDS_AT ? new Date(env.CAMPAIGN_ENDS_AT) : null,
      privacyNoticeVersion: env.PRIVACY_NOTICE_VERSION,
      privacyNoticeUrl: env.PRIVACY_NOTICE_URL,
    }).returning();
    if (!campaign) {
      throw new Error("Falha ao criar campanha inicial.");
    }
    await db.insert(campaignPlacements).values({
      placementKey: "institutional_modal",
      campaignId: campaign.id,
      publishedAt: new Date(),
    }).onConflictDoNothing();
    console.info("Campanha inicial criada.");
  } else if (existingCampaign.status === "active") {
    await db.insert(campaignPlacements).values({
      placementKey: "institutional_modal",
      campaignId: existingCampaign.id,
      publishedAt: new Date(),
    }).onConflictDoNothing();
  }
}

seed()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("Falha ao executar seed.", error);
    await pool.end();
    process.exitCode = 1;
  });
