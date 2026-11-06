import { describe, expect, it } from "vitest";
import { editorialRevisionSchema, extractEditorialAssetIds } from "../../src/schemas/editorial.js";

const validRevision = {
  title: "Festa da Rádio",
  excerpt: "Resumo editorial da festa anual da emissora.",
  slug: "festa-da-radio",
  categoryId: "2706e27d-a85e-4ba0-92c3-5f9680a60a44",
  coverAssetId: "c084fb6b-df13-4fa1-a861-0579ba976ea5",
  coverAlt: "Equipe reunida na festa",
  seoTitle: "Festa da Rádio 88 FM",
  seoDescription: "Veja os melhores momentos da festa da Rádio 88 FM.",
  blocks: [],
};

describe("editorial promotion CTA", () => {
  it("applies the default text and local destination for older clients", () => {
    const parsed = editorialRevisionSchema.parse(validRevision);
    expect(parsed.promoCtaText).toBe("Anuncie sua marca na Rádio 88 FM");
    expect(parsed.promoCtaUrl).toBe("/anuncie");
  });

  it("accepts local and HTTP(S) destinations but rejects protocol-relative or unsafe URLs", () => {
    expect(editorialRevisionSchema.safeParse({ ...validRevision, promoCtaUrl: "/anuncie" }).success).toBe(true);
    expect(editorialRevisionSchema.safeParse({ ...validRevision, promoCtaUrl: "https://example.com/anuncie" }).success).toBe(true);
    expect(editorialRevisionSchema.safeParse({ ...validRevision, promoCtaUrl: "//example.com/anuncie" }).success).toBe(false);
    expect(editorialRevisionSchema.safeParse({ ...validRevision, promoCtaUrl: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("editorial media references", () => {
  it("includes distinct cover and opening art in the release media set", () => {
    const ids = extractEditorialAssetIds({
      coverAssetId: "cover-asset",
      openingAssetId: "opening-asset",
      blocks: [],
    });

    expect(ids).toEqual(["cover-asset", "opening-asset"]);
  });

  it("falls back to the cover asset for older revisions without opening art", () => {
    const ids = extractEditorialAssetIds({
      coverAssetId: "cover-asset",
      blocks: [],
    });

    expect(ids).toEqual(["cover-asset"]);
  });
});
