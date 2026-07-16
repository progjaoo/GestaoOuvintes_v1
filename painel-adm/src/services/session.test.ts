import { describe, expect, it } from "vitest";
import {
  clearSession,
  getAccessToken,
  getSession,
  setSession,
} from "@/services/session";

const session = {
  accessToken: "token-test",
  user: {
    id: "admin-id",
    name: "Administrador",
    username: "admin",
    role: "admin" as const,
  },
};

describe("session", () => {
  it("persiste apenas a sessão administrativa em sessionStorage", () => {
    setSession(session);
    expect(getSession()).toEqual(session);
    expect(getAccessToken()).toBe("token-test");
    expect(localStorage.length).toBe(0);
  });

  it("remove a sessão", () => {
    setSession(session);
    clearSession();
    expect(getSession()).toBeNull();
    expect(getAccessToken()).toBeNull();
  });
});
