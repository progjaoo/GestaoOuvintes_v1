import { describe, expect, it } from "vitest";
import {
  createInstitutionalBannerSchema,
  updateInstitutionalBannerSchema,
} from "../../src/schemas/institutional-banner.js";

const commonInput = {
  title: "Sorteio da Radio 88",
  altText: "Banner do sorteio da Radio 88 FM",
  placementKey: "home_hero",
  mediaAssetId: "4d96ee86-09ef-46e9-8441-d97ed40eb880",
  active: true,
};

describe("institutional banner action schema", () => {
  it("accepts listener modal action without destination URL", () => {
    expect(
      createInstitutionalBannerSchema.parse({
        ...commonInput,
        actionType: "listener_registration_modal",
      }),
    ).toMatchObject({
      actionType: "listener_registration_modal",
      destinationUrl: null,
      openInNewTab: false,
    });
  });

  it("requires a destination URL for external URL action", () => {
    const result = createInstitutionalBannerSchema.safeParse({
      ...commonInput,
      actionType: "external_url",
      destinationUrl: null,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a destination URL for listener modal action", () => {
    const result = createInstitutionalBannerSchema.safeParse({
      ...commonInput,
      actionType: "listener_registration_modal",
      destinationUrl: "https://radio88fm.com.br/cadastro",
    });

    expect(result.success).toBe(false);
  });

  it("normalizes openInNewTab to false for actions without navigation", () => {
    expect(
      createInstitutionalBannerSchema.parse({
        ...commonInput,
        actionType: "none",
        openInNewTab: true,
      }),
    ).toMatchObject({
      actionType: "none",
      destinationUrl: null,
      openInNewTab: false,
    });
  });

  it("accepts partial updates and leaves final-state validation to the service", () => {
    expect(
      updateInstitutionalBannerSchema.parse({
        actionType: "listener_registration_modal",
      }),
    ).toEqual({
      actionType: "listener_registration_modal",
    });
  });
});
