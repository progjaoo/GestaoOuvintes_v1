import sharp from 'sharp';

// Sample the right edge, where the artwork meets the program information panel.
export async function programImageEdgeColor(input: Buffer): Promise<string | null> {
  const { data, info } = await sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 })
    .rotate().resize({ width: 160, height: 160, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const band = Math.max(1, Math.ceil(info.width * 0.02));
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  let count = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = info.width - band; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset + 3]! < 200) continue;
      const [r, g, b] = [data[offset]!, data[offset + 1]!, data[offset + 2]!];
      const key = [r, g, b].map(value => Math.floor(value / 32)).join(':');
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b;
      buckets.set(key, bucket); count++;
    }
  }
  const dominant = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  if (!dominant || count < 8 || dominant.count / count < 0.2) return null;
  return '#' + [dominant.r, dominant.g, dominant.b]
    .map(value => Math.round(value / dominant.count).toString(16).padStart(2, '0')).join('').toUpperCase();
}
