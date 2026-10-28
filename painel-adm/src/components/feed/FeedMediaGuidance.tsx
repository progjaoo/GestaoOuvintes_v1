export type FeedMediaUsage = "card" | "opening" | "body" | "gif" | "video" | "poster";

const guidance: Record<FeedMediaUsage, string> = {
  card: "Capa do card do Feed: recomendado 1260 × 900 px (7:5).",
  opening: "Imagem de abertura: recomendado 1920 × 1080 px (16:9).",
  body: "Imagem do corpo ou galeria: recomendado 1920 px de largura, preservando a proporção e a imagem inteira, sem cortes ou distorções.",
  gif: "GIF: preserve a proporção original e a animação inteira. Para o poster estático, recomendado 1920 × 1080 px (16:9), com arte adequada a esse formato, sem distorcer.",
  video: "Vídeo: preserve a proporção original. Para o poster estático, recomendado 1920 × 1080 px (16:9), com arte adequada a esse formato, sem distorcer.",
  poster: "Poster estático de GIF ou vídeo: recomendado 1920 × 1080 px (16:9), com arte adequada a esse formato, sem distorcer.",
};

export function FeedMediaGuidance({ usage }: { usage?: FeedMediaUsage }) {
  if (usage) return <p className="mt-2 text-xs leading-5 text-genesis-muted">{guidance[usage]}</p>;

  return <div className="space-y-2 text-xs leading-5 text-genesis-muted">
    <p className="font-semibold text-genesis-text">Padrões recomendados para o Feed</p>
    <ul className="list-disc space-y-1 pl-4">
      {(["card", "opening", "body", "poster"] as const).map((kind) => <li key={kind}>{guidance[kind]}</li>)}
    </ul>
    <p>São recomendações, não requisitos de upload. Arquivos antigos ou com outras dimensões continuam utilizáveis; não estique nem recorte automaticamente para atingir esses tamanhos.</p>
  </div>;
}
