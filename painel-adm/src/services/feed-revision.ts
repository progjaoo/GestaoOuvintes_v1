import type { EditorialRevisionInput } from "@/types/feed";

// Keep legacy API descriptions without making the editorial team fill extra fields.
export function prepareFeedRevision(input: EditorialRevisionInput): EditorialRevisionInput {
  const title = input.title.trim() || "Rádio 88 FM";
  const description = (value: unknown, fallback: string) => typeof value === "string" && value.trim().length >= 2 ? value.trim().slice(0, 220) : fallback.slice(0, 220);
  return { ...input, coverAlt: description(input.coverAlt, title), openingAlt: description(input.openingAlt, title), blocks: input.blocks.map((block, index) => {
    if (block.type === "image" || block.type === "gif") return { ...block, alt: description(block.alt, description(block.caption, `${title} · imagem ${index + 1}`)) };
    if (block.type === "gallery" && Array.isArray(block.items)) return { ...block, items: block.items.map((item: Record<string, unknown>, at: number) => ({ ...item, alt: description(item.alt, description(item.caption, `${title} · galeria ${at + 1}`)) })) };
    if (block.type === "video") return { ...block, title: description(block.title, title).slice(0, 180) };
    return block;
  }) };
}
