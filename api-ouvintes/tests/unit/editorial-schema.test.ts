import { describe, expect, it } from "vitest";
import { extractEditorialAssetIds } from "../../src/schemas/editorial.js";

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
