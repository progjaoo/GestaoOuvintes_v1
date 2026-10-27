import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/radio88_test";
process.env.JWT_SECRET ??= "test-jwt-secret-that-is-at-least-32-characters";
process.env.IP_HASH_SECRET ??= "test-ip-hash-secret-value";
process.env.ADMIN_INITIAL_PASSWORD ??= "test-password-12345";
process.env.CAMPAIGN_STARTS_AT ??= "2026-01-01T00:00:00Z";
process.env.PUBLIC_CONFIG_NAMESPACE = "test/radio-88";

const { parseSnapshot, getSnapshotBanners } = await import("../src/services/public-config-snapshot.js");
const { env } = await import("../src/config/env.js");

const banner = {
  id: "fd0052c2-1303-45df-819b-fabfdcd1775c", title: "Festa", altText: "Festa da radio",
  placementKey: "home_hero", imageUrl: "https://media.example/festa.webp", actionType: "none",
  destinationUrl: null, openInNewTab: false, order: 2,
};

function snapshot(isPrimary?: boolean) {
  const content = {
    schemaVersion: 1 as const, namespace: "test/radio-88", campaigns: [], placements: [],
    banners: [{ ...banner, ...(isPrimary === undefined ? {} : { isPrimary }) }],
  };
  return {
    ...content,
    revision: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
    generatedAt: "2026-10-27T12:00:00.000Z",
  };
}

describe("evolucao do snapshot de banner principal", () => {
  it("aceita snapshot legado sem modificar os campos usados no hash", () => {
    const legacy = snapshot();
    expect(parseSnapshot(legacy)).toEqual(legacy);
    expect(parseSnapshot(legacy).banners[0]).not.toHaveProperty("isPrimary");
  });

  it("aceita o campo novo e inclui a escolha na revisao", () => {
    expect(parseSnapshot(snapshot(true)).banners[0]!.isPrimary).toBe(true);
    expect(snapshot(true).revision).not.toBe(snapshot(false).revision);
    expect(snapshot(false).revision).not.toBe(snapshot().revision);
  });

  it("rejeita uma troca de principal sem recalcular o hash", () => {
    const modified = snapshot(true);
    modified.banners[0]!.isPrimary = false;
    expect(() => parseSnapshot(modified)).toThrow("Snapshot revision or namespace mismatch");
  });

  it("le o formato novo durante preparacao e so expoe destaque com a flag ativa", () => {
    const previous = env.INSTITUTIONAL_PRIMARY_BANNER_ENABLED;
    try {
      env.INSTITUTIONAL_PRIMARY_BANNER_ENABLED = false;
      expect(getSnapshotBanners(parseSnapshot(snapshot(true)), "home_hero").items[0]!.isPrimary).toBe(false);
      env.INSTITUTIONAL_PRIMARY_BANNER_ENABLED = true;
      expect(getSnapshotBanners(parseSnapshot(snapshot(true)), "home_hero").items[0]!.isPrimary).toBe(true);
      expect(getSnapshotBanners(parseSnapshot(snapshot()), "home_hero").items[0]!.isPrimary).toBe(false);
    } finally {
      env.INSTITUTIONAL_PRIMARY_BANNER_ENABLED = previous;
    }
  });
});
