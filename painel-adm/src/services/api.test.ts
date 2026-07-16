import { describe, expect, it } from "vitest";
import { toQueryString } from "@/services/api";

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
});
