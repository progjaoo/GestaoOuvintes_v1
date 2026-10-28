import { afterEach, describe, expect, it, vi } from "vitest";
import { openFeedPreview, type FeedPreviewData } from "./feed-preview-channel";

describe("prévia em aba separada", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("envia o rascunho somente por canal em memória e remove opener", () => {
    vi.useFakeTimers();
    const channel = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: vi.fn(), close: vi.fn() };
    vi.stubGlobal("BroadcastChannel", class { constructor() { return channel; } });
    const tab = { opener: window };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const payload = { revision: { title: "Rascunho não publicado" }, categories: [] } as unknown as FeedPreviewData;
    expect(openFeedPreview(payload)).toBe(true);
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^\/conteudo\/feed\/previa\/[\da-f-]{36}$/), "_blank");
    expect(tab.opener).toBeNull();
    channel.onmessage?.(new MessageEvent("message", { data: "ready" }));
    expect(channel.postMessage).toHaveBeenCalledWith(payload);
    expect(localStorage.length).toBe(0);
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(channel.close).toHaveBeenCalledOnce();
  });
  it("trata bloqueio de pop-up sem perder o rascunho", () => {
    const close = vi.fn();
    vi.stubGlobal("BroadcastChannel", class { close = close; });
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(openFeedPreview({} as FeedPreviewData)).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });
});
