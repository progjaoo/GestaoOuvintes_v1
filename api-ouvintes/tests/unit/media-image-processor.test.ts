import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { processBannerImage } from "../../src/services/media-storage/media-image-processor.js";

describe("processBannerImage", () => {
  it.each(["jpeg", "png", "webp", "avif"] as const)(
    "normaliza uma imagem %s valida para WebP",
    async (format) => {
      const image = sharp({
        create: {
          width: 320,
          height: 180,
          channels: 4,
          background: { r: 19, g: 96, b: 232, alpha: 1 },
        },
      });
      const input = await image[format]().toBuffer();

      const result = await processBannerImage(input, `banner.${format}`);

      expect(result.mimeType).toBe("image/webp");
      expect(result.extension).toBe("webp");
      expect(result.buffer.length).toBeGreaterThan(0);
    },
  );

  it("normaliza uma imagem valida para WebP e remove metadados", async () => {
    const input = await sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 4,
        background: { r: 19, g: 96, b: 232, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const result = await processBannerImage(input, "banner.png");

    expect(result.mimeType).toBe("image/webp");
    expect(result.extension).toBe("webp");
    expect(result.width).toBe(1600);
    expect(result.height).toBe(900);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("rejeita bytes que nao representam uma imagem permitida", async () => {
    await expect(
      processBannerImage(Buffer.from("<script>alert(1)</script>"), "ataque.png"),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE_TYPE" });
  });

  it("preserva a causa interna quando os bytes parecem PNG mas estao corrompidos", async () => {
    const validPng = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 19, g: 96, b: 232, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const corruptPng = validPng.subarray(0, 40);

    await expect(processBannerImage(corruptPng, "corrompido.png")).rejects.toMatchObject({
      code: "INVALID_IMAGE",
      cause: expect.any(Error),
    });
  });
});
