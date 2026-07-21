const MAX_BANNER_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_BANNER_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

export function validateInstitutionalBannerFile(file: File): string | null {
  if (!ALLOWED_BANNER_MIME_TYPES.has(file.type)) {
    return "Selecione uma imagem JPEG, PNG, WebP ou AVIF.";
  }
  if (file.size > MAX_BANNER_FILE_BYTES) {
    return "A imagem deve ter no máximo 10 MiB.";
  }
  return null;
}
