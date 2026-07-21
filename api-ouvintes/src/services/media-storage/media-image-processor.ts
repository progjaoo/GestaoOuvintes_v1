import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { AppError } from "../../lib/errors.js";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

export interface ProcessedBannerImage {
  buffer: Buffer;
  mimeType: "image/webp";
  extension: "webp";
  width: number;
  height: number;
  originalName: string;
}

function sanitizeOriginalName(name: string) {
  const normalized = name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized.slice(0, 255) || "banner";
}

export async function processBannerImage(
  input: Buffer,
  originalName: string,
): Promise<ProcessedBannerImage> {
  const detected = await fileTypeFromBuffer(input);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
    throw new AppError(
      415,
      "INVALID_IMAGE_TYPE",
      "Envie uma imagem JPEG, PNG, WebP ou AVIF valida.",
    );
  }

  try {
    const image = sharp(input, {
      failOn: "error",
      limitInputPixels: 40_000_000,
    }).rotate();

    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("Dimensoes indisponiveis.");
    }

    const buffer = await image
      .resize({ width: 2400, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88, effort: 4 })
      .toBuffer();

    const outputMetadata = await sharp(buffer).metadata();

    return {
      buffer,
      mimeType: "image/webp",
      extension: "webp",
      width: outputMetadata.width ?? metadata.width,
      height: outputMetadata.height ?? metadata.height,
      originalName: sanitizeOriginalName(originalName),
    };
  } catch (cause) {
    throw new AppError(
      422,
      "INVALID_IMAGE",
      "Nao foi possivel processar a imagem.",
      { stage: "image_processing" },
      { cause },
    );
  }
}
