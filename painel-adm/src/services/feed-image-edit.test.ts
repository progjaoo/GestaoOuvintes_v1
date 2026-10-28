import { describe, expect, it } from "vitest";
import { imageCrop } from "./feed-image-edit";

describe("recorte editorial", () => {
  it("centraliza capa e abertura com proporção exata sem distorcer", () => {
    const card = imageCrop(1920, 1080, 7 / 5, 1, 50, 50);
    expect(card).toEqual({ x: 204, y: 0, width: 1512, height: 1080 });
    expect(imageCrop(1920, 1080, 16 / 9, 1, 50, 50)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
  it("limita zoom e posição sem sair da imagem, inclusive em retrato girado", () => {
    for (const [width, height] of [[800, 1200], [1200, 800]]) {
      const crop = imageCrop(width, height, 16 / 9, 2, 1000, -50);
      expect(crop.x + crop.width).toBeLessThanOrEqual(width);
      expect(crop.y).toBe(0);
      expect(crop.y + crop.height).toBeLessThanOrEqual(height);
      expect(crop.width / crop.height).toBeCloseTo(16 / 9);
    }
  });
  it("rejeita dimensões inválidas", () => {
    expect(() => imageCrop(0, 100, 1, 1, 50, 50)).toThrow();
    expect(() => imageCrop(100, 100, NaN, 1, 50, 50)).toThrow();
  });
});
