import { describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://radio88:radio88_test_password@127.0.0.1:5435/radio88_test";
process.env.DATABASE_SSL = "false";
process.env.JWT_SECRET ??= "test-jwt-secret-that-is-at-least-32-characters";
process.env.IP_HASH_SECRET ??= "test-ip-hash-secret-value";
process.env.ADMIN_INITIAL_PASSWORD ??= "test-password-12345";
process.env.CAMPAIGN_STARTS_AT ??= "2026-01-01T00:00:00Z";
process.env.PUBLIC_CONFIG_NAMESPACE ??= "test/radio-88";

const {
  getSnapshotBanners,
  getSnapshotCampaign,
  getSnapshotPlacement,
  publicConfigCacheControl,
} = await import("../src/services/public-config-snapshot.js");

const campaignId = "0f941a9f-148c-44f9-9443-193f73f7c190";
const snapshot = {
  schemaVersion: 1 as const,
  namespace: "test/radio-88",
  revision: `${"00000000000a"}${"a".repeat(52)}`,
  generatedAt: "2026-10-16T12:00:00.000Z",
  campaigns: [
    {
      id: campaignId,
      slug: "campanha-ativa",
      type: "registration",
      status: "active",
      title: "Campanha ativa",
      description: "Descricao publica",
      privacyNoticeVersion: "2026-10-01",
      privacyNoticeUrl: "/privacidade",
      termsUrl: null,
      startsAt: "2026-10-16T12:00:00.000Z",
      endsAt: "2026-10-16T13:00:00.000Z",
    },
    {
      id: "9fd2852b-c9c6-4679-8e78-ddd9ff95c832",
      slug: "campanha-futura",
      type: "sweepstake",
      status: "active",
      title: "Campanha futura",
      description: "Ainda nao iniciou",
      privacyNoticeVersion: "2026-10-01",
      privacyNoticeUrl: "/privacidade",
      termsUrl: null,
      startsAt: "2026-10-16T12:01:00.000Z",
      endsAt: "2026-10-16T13:00:00.000Z",
    },
  ],
  placements: [
    { placementKey: "institutional_modal", campaignId, version: 7 },
  ],
  banners: [
    {
      id: "fd0052c2-1303-45df-819b-fabfdcd1775c",
      title: "Banner da rádio",
      altText: "Banner institucional da Rádio 88 FM",
      placementKey: "home_hero",
      imageUrl: "https://media.radio88fm.com/banners-institucional/teste.webp",
      actionType: "none",
      destinationUrl: null,
      openInNewTab: false,
      order: 1,
    },
  ],
};

describe("public config snapshot contract", () => {
  it("returns campaign as unavailable before its start and caps cache TTL at transition", () => {
    const now = new Date("2026-10-16T12:00:30.000Z");
    const future = getSnapshotCampaign(snapshot, "campanha-futura", now);
    const campaign = snapshot.campaigns[1];

    expect(future).toEqual({ slug: "campanha-futura", active: false });
    expect(publicConfigCacheControl(snapshot, campaign, now)).toBe("public, max-age=0, s-maxage=30");
  });

  it("keeps the legacy campaign and placement response fields", () => {
    const now = new Date("2026-10-16T12:30:00.000Z");
    expect(getSnapshotCampaign(snapshot, "campanha-ativa", now)).toEqual({
      slug: "campanha-ativa",
      active: true,
      title: "Campanha ativa",
      description: "Descricao publica",
      privacyNoticeVersion: "2026-10-01",
      privacyNoticeUrl: "/privacidade",
      termsUrl: null,
      startsAt: "2026-10-16T12:00:00.000Z",
      endsAt: "2026-10-16T13:00:00.000Z",
    });
    expect(getSnapshotPlacement(snapshot, "institutional_modal", now).campaign).toEqual({
      id: campaignId,
      slug: "campanha-ativa",
      type: "registration",
      active: true,
      title: "Campanha ativa",
      description: "Descricao publica",
      privacyNoticeVersion: "2026-10-01",
      privacyNoticeUrl: "/privacidade",
      termsUrl: null,
      startsAt: "2026-10-16T12:00:00.000Z",
      endsAt: "2026-10-16T13:00:00.000Z",
    });
  });

  it("returns empty configuration for unknown placements and stable banner versions", () => {
    expect(getSnapshotPlacement(snapshot, "unknown_placement").campaign).toBeNull();
    expect(getSnapshotBanners(snapshot, "missing_placement")).toEqual({
      version: 10,
      items: [],
    });
    expect(getSnapshotBanners(snapshot, "home_hero").items).toHaveLength(1);
  });
});
