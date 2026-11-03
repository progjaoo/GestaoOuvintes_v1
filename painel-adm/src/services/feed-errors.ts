import { ApiError } from "./api";

export function feedErrorMessage(error: Error): string {
  if (!(error instanceof ApiError) || !error.fields?.length) return error.message || "Não foi possível concluir a operação.";
  const labels: Record<string, string> = { title: "Título", excerpt: "Resumo", slug: "Slug", categoryId: "Categoria", coverAssetId: "Capa", openingAssetId: "Abertura", seoTitle: "Título SEO", seoDescription: "Descrição SEO", eventDate: "Data do acontecimento", assetId: "Imagem/GIF", videoId: "Vídeo do YouTube", posterAssetId: "Poster", content: "Texto", alt: "Descrição da imagem" };
  return error.fields.map(({ path, message }) => {
    const block = path.match(/blocks\.(\d+)/);
    const field = path.split(".").at(-1) ?? path;
    return `${block ? `Bloco ${Number(block[1]) + 1} · ` : ""}${labels[field] ?? field}: ${message}`;
  }).join("\n");
}

export function validateFeedBlocks(blocks: Array<Record<string, unknown>>) {
  for (const [index, block] of blocks.entries()) {
    const prefix = `Bloco ${index + 1}: `;
    if ((block.type === "image" || block.type === "gif") && !block.assetId) throw new Error(prefix + "escolha o arquivo ou remova este bloco vazio antes de salvar.");
    if (block.type === "gallery" && (!Array.isArray(block.items) || block.items.length < 2 || block.items.some((item) => !item.assetId))) throw new Error(prefix + "selecione pelo menos duas imagens para a galeria.");
    if (block.type === "video") {
      const source = block.source as { kind?: string; assetId?: string; videoId?: string } | undefined;
      if (source?.kind === "youtube" && !/^[A-Za-z0-9_-]{11}$/.test(source.videoId ?? "")) throw new Error(prefix + "informe uma URL ou ID válido do YouTube.");
      if (source?.kind === "asset" && (!source.assetId || !block.posterAssetId)) throw new Error(prefix + "selecione o vídeo MP4 e seu poster.");
    }
  }
}
