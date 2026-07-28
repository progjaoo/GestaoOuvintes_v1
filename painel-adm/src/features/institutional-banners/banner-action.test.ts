import { describe, expect, it } from "vitest";
import { buildInstitutionalBannerAction } from "./banner-action";

describe("buildInstitutionalBannerAction", () => {
  it("clears navigation fields when the banner opens the registration modal", () => {
    expect(
      buildInstitutionalBannerAction(
        "listener_registration_modal",
        "https://radio88fm.com.br/cadastro",
        true,
      ),
    ).toEqual({
      actionType: "listener_registration_modal",
      destinationUrl: null,
      openInNewTab: false,
    });
  });

  it("requires a destination for external links", () => {
    expect(() =>
      buildInstitutionalBannerAction("external_url", " ", false),
    ).toThrow("Informe o link de destino");
  });

  it("preserves external-link configuration", () => {
    expect(
      buildInstitutionalBannerAction(
        "external_url",
        "https://radio88fm.com.br/promocao",
        true,
      ),
    ).toEqual({
      actionType: "external_url",
      destinationUrl: "https://radio88fm.com.br/promocao",
      openInNewTab: true,
    });
  });
});
