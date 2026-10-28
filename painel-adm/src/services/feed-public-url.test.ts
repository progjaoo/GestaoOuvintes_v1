import { describe, expect, it } from "vitest";
import { feedPublicPostUrl } from "./feed-public-url";

describe("URL publica do Feed por ambiente", () => {
  it("usa o institucional configurado, nunca a origem do painel", () => {
    expect(feedPublicPostUrl("https://site-preview.vercel.app/", "festa-2026"))
      .toBe("https://site-preview.vercel.app/feed/festa-2026");
    expect(feedPublicPostUrl("http://127.0.0.1:8086", "festa-2026"))
      .toBe("http://127.0.0.1:8086/feed/festa-2026");
  });

  it("falha fechado sem destino ou com credenciais, query ou slug invalido", () => {
    for (const base of [undefined, "", "invalid", "javascript:alert(1)", "http://external.test", "https://user:secret@site.test", "https://site.test?secret=abc", "https://site.test#abc"]) {
      expect(feedPublicPostUrl(base, "festa-2026")).toBeNull();
    }
    expect(feedPublicPostUrl("https://site.test", "../admin")).toBeNull();
  });
});
