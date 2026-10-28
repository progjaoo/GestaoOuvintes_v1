export interface ImageCrop { x: number; y: number; width: number; height: number }

export function imageCrop(width: number, height: number, ratio: number, zoom: number, x: number, y: number): ImageCrop {
  if (![width, height, ratio, zoom, x, y].every(Number.isFinite) || width <= 0 || height <= 0 || ratio <= 0) throw new Error("Dimensões inválidas.");
  const scale = Math.max(1, Math.min(3, zoom));
  const cropWidth = Math.min(width, height * ratio) / scale;
  const cropHeight = cropWidth / ratio;
  return { x: (width - cropWidth) * Math.max(0, Math.min(100, x)) / 100, y: (height - cropHeight) * Math.max(0, Math.min(100, y)) / 100, width: cropWidth, height: cropHeight };
}

export async function exportEditedImage(image: HTMLImageElement, file: File, rotation: number, crop: ImageCrop, targetWidth: number): Promise<File> {
  const rotated = document.createElement("canvas");
  const quarterTurn = rotation % 180 !== 0;
  rotated.width = quarterTurn ? image.naturalHeight : image.naturalWidth;
  rotated.height = quarterTurn ? image.naturalWidth : image.naturalHeight;
  const context = rotated.getContext("2d");
  if (!context) throw new Error("Seu navegador não suporta edição de imagens.");
  context.translate(rotated.width / 2, rotated.height / 2);
  context.rotate(rotation * Math.PI / 180);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.min(targetWidth, Math.round(crop.width)));
  output.height = Math.max(1, Math.round(output.width * crop.height / crop.width));
  const result = output.getContext("2d");
  if (!result) throw new Error("Não foi possível preparar a imagem.");
  result.drawImage(rotated, crop.x, crop.y, crop.width, crop.height, 0, 0, output.width, output.height);
  const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error("Não foi possível exportar a imagem.")), "image/webp", 0.92));
  if (blob.size > 10 * 1024 * 1024) throw new Error("A imagem editada excede 10 MB. Aumente o recorte ou reduza o arquivo.");
  const extension = blob.type === "image/webp" ? "webp" : "png";
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-editada.${extension}`, { type: blob.type });
}
