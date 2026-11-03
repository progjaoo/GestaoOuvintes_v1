import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { feedErrorMessage, validateFeedBlocks } from "./feed-errors";

describe("editorial validation feedback", () => {
  it("identifies the invalid block instead of only saying Dados invalidos", () => {
    expect(feedErrorMessage(new ApiError(400, "VALIDATION_ERROR", "Dados invalidos.", [{ path: "revision.blocks.2.assetId", message: "Invalid UUID" }]))).toContain("Bloco 3 · Imagem/GIF");
  });
  it("rejects incomplete image, GIF, gallery and YouTube blocks before sending", () => {
    for (const block of [{ type: "image", assetId: "" }, { type: "gif", assetId: "" }, { type: "gallery", items: [] }, { type: "video", source: { kind: "youtube", videoId: "" } }]) expect(() => validateFeedBlocks([block])).toThrow(/Bloco 1/);
  });
  it("accepts complete image and text blocks", () => {
    expect(() => validateFeedBlocks([{ type: "image", assetId: "ready-image" }, { type: "text", content: {} }])).not.toThrow();
  });
});
