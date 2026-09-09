import { describe, expect, it } from "vitest";
import {
  DEFAULT_TENANT_ID,
  getDefaultTenantContext,
} from "../../src/services/tenant-service.js";
import {
  createMediaObjectKey,
  isManagedMediaObjectKey,
} from "../../src/services/media-storage/media-object-key.js";

describe("tenant foundation", () => {
  it("preserves the radio-88 compatibility context while tenancy is disabled", () => {
    expect(getDefaultTenantContext()).toMatchObject({
      tenantId: DEFAULT_TENANT_ID,
      tenantSlug: "radio-88",
      timezone: "America/Sao_Paulo",
    });
  });

  it("accepts both legacy and tenant-managed media object keys", () => {
    expect(isManagedMediaObjectKey("banners-institucional/2026/08/banner.webp")).toBe(true);
    expect(isManagedMediaObjectKey("tenants/radio-88/banners-institucional/2026/08/banner.webp")).toBe(true);
    expect(isManagedMediaObjectKey("other-prefix/banner.webp")).toBe(false);
  });

  it("keeps the legacy object path until tenant media rollout is enabled", () => {
    expect(createMediaObjectKey("webp", "radio-88")).toMatch(
      /^banners-institucional\/\d{4}\/\d{2}\/[a-f0-9-]+\.webp$/,
    );
  });
});
