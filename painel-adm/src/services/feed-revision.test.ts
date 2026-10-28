import { describe, expect, it } from "vitest";
import { prepareFeedRevision } from "./feed-revision";
import type { EditorialRevisionInput } from "@/types/feed";

describe("metadados automáticos do editor", () => {
  it("preenche descrições sem novos campos obrigatórios e preserva dados antigos", () => {
    const input = { excerpt: "Resumo da festa da rádio", slug: "festa", categoryId: "category", coverAssetId: "cover", openingAssetId: "opening", coverFocusX: 50, coverFocusY: 50, openingFocusX: 50, openingFocusY: 50, seoTitle: "Festa", seoDescription: "Resumo da festa da rádio", eventDate: null, publicCredits: "", title: "Festa da Rádio", coverAlt: "", openingAlt: "Descrição anterior", blocks: [
      { id: "1", type: "image", alt: "", caption: "Equipe da festa" },
      { id: "2", type: "gallery", items: [{ assetId: "a", alt: "Descrição editorial" }, { assetId: "b", alt: "" }] },
      { id: "3", type: "gif", alt: "" }, { id: "4", type: "video", title: "" },
    ] } as EditorialRevisionInput;
    const revision = prepareFeedRevision(input);
    expect(revision.coverAlt).toBe("Festa da Rádio");
    expect(revision.openingAlt).toBe("Descrição anterior");
    expect(revision.blocks[0].alt).toBe("Equipe da festa");
    expect(revision.blocks[1].items).toEqual([{ assetId: "a", alt: "Descrição editorial" }, { assetId: "b", alt: "Festa da Rádio · galeria 2" }]);
    expect(revision.blocks[2].alt).toContain("Festa da Rádio");
    expect(revision.blocks[3].title).toBe("Festa da Rádio");
    expect(input.coverAlt).toBe("");
  });
});
