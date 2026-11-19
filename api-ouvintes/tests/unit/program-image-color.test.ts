import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { programImageEdgeColor } from '../../src/services/program-image-color.js';

describe('program artwork edge color', () => {
  it('uses the edge instead of the center or the file name', async () => {
    const base = sharp({ create: { width: 1920, height: 1080, channels: 4, background: '#1266CC' } });
    const border = await sharp({ create: { width: 100, height: 1080, channels: 4, background: '#E73C24' } }).png().toBuffer();
    const image = await base.composite([{ input: border, left: 1820, top: 0 }]).webp({ lossless: true }).toBuffer();
    const color = await programImageEdgeColor(image);
    expect(color).toMatch(/^#[0-9A-F]{6}$/);
    expect(parseInt(color!.slice(1, 3), 16)).toBeGreaterThan(200);
    expect(parseInt(color!.slice(3, 5), 16)).toBeLessThan(90);
  });
  it('does not invent a color from transparent pixels', async () => {
    const image = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    expect(await programImageEdgeColor(image)).toBeNull();
  });
  it('rejects invalid files', async () => {
    await expect(programImageEdgeColor(Buffer.from('not an image'))).rejects.toThrow();
  });
});
