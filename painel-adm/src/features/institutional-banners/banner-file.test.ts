import { describe, expect, it } from "vitest";
import { validateInstitutionalBannerFile } from "./banner-file";

describe("validateInstitutionalBannerFile", () => {
  it("aceita os formatos permitidos dentro do limite", () => {
    const file = new File([new Uint8Array(128)], "banner.png", { type: "image/png" });

    expect(validateInstitutionalBannerFile(file)).toBeNull();
  });

  it("rejeita formato nao permitido", () => {
    const file = new File(["<svg />"], "banner.svg", { type: "image/svg+xml" });

    expect(validateInstitutionalBannerFile(file)).toBe(
      "Selecione uma imagem JPEG, PNG, WebP ou AVIF.",
    );
  });

  it("rejeita arquivo acima de 10 MiB", () => {
    const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "banner.png", {
      type: "image/png",
    });

    expect(validateInstitutionalBannerFile(file)).toBe(
      "A imagem deve ter no máximo 10 MiB.",
    );
  });
});
