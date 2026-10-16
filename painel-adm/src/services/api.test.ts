import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  getPublicConfigSyncPending,
  PUBLIC_CONFIG_SYNC_EVENT,
  toQueryString,
} from "@/services/api";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("api helpers", () => {
  it("omite filtros vazios e serializa booleanos", () => {
    const query = toQueryString({
      page: 2,
      city: "",
      campaignId: undefined,
      hasPhone: false,
    });

    expect(query).toBe("?page=2&hasPhone=false");
  });

  it("notifica a pendência mesmo quando o navegador bloqueia localStorage", async () => {
    const onSync = vi.fn();
    window.addEventListener(PUBLIC_CONFIG_SYNC_EVENT, onSync);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ syncStatus: "pending", revision: null }), {
          headers: { "content-type": "application/json", "x-public-config-sync": "pending" },
        }),
      ),
    );

    await api.republishPublicConfig();

    expect(getPublicConfigSyncPending()).toBe(true);
    expect(onSync).toHaveBeenCalledOnce();
    expect(onSync.mock.calls[0]?.[0]).toMatchObject({
      detail: { pending: true, revision: null },
    });
    window.removeEventListener(PUBLIC_CONFIG_SYNC_EVENT, onSync);
  });
});
