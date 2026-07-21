import { describe, expect, it } from "vitest";
import { normalizeR2StorageError } from "../../src/services/media-storage/r2-media-storage.js";

describe("normalizeR2StorageError", () => {
  it("transforma falha de upload em erro de gateway sem expor a causa", () => {
    const cause = new Error("The provided token is invalid");

    const error = normalizeR2StorageError("put", cause);

    expect(error).toMatchObject({
      statusCode: 502,
      code: "R2_UPLOAD_FAILED",
      message: "Nao foi possivel armazenar a imagem.",
      cause,
    });
    expect(error.message).not.toContain("token");
  });

  it("transforma falha de exclusao em erro de gateway especifico", () => {
    const error = normalizeR2StorageError("delete", new Error("network"));

    expect(error).toMatchObject({
      statusCode: 502,
      code: "R2_DELETE_FAILED",
      message: "Nao foi possivel remover a imagem do armazenamento.",
    });
  });
});
