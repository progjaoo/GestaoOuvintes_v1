import { describe, expect, it } from "vitest";
import {
  createAuthorizationContext,
  hasGlobalPermission,
  hasPermission,
  hasPermissionScope,
  isValidAuthorizationIdentity,
  type AuthorizationRow,
} from "../../src/services/authorization-service.js";

const userId = "b7b760a1-2144-42e6-b2cb-0bec3198f444";
const sessionId = "88863fb3-791b-4128-837f-aefcb854fdc8";
const departmentId = "5f208703-a33d-44f6-98ad-e86793f27d09";

function row(overrides: Partial<AuthorizationRow> = {}): AuthorizationRow {
  return {
    admin_user_id: userId,
    session_id: sessionId,
    authz_version: 3,
    permission_key: "board.read",
    scope_type: "global",
    department_id: null,
    department_ids: [departmentId],
    ...overrides,
  };
}

describe("central authorization policy", () => {
  it("requires valid UUID identities and a positive integer authorization version", () => {
    expect(isValidAuthorizationIdentity(userId, sessionId, 1)).toBe(true);
    expect(isValidAuthorizationIdentity(userId, "bad-id", 1)).toBe(false);
    expect(isValidAuthorizationIdentity(userId, sessionId, 0)).toBe(false);
    expect(isValidAuthorizationIdentity(userId, sessionId, "1")).toBe(false);
  });

  it("fails closed when the current account or permission query returns no row", () => {
    expect(createAuthorizationContext([])).toBeNull();
    expect(hasPermission(null, "board.read")).toBe(false);
  });

  it("resolves explicit permissions without an admin-role wildcard", () => {
    const context = createAuthorizationContext([row()]);
    expect(hasPermission(context, "board.read")).toBe(true);
    expect(hasPermission(context, "user.manage")).toBe(false);
  });

  it("does not treat a scoped grant as permission for an unfiltered endpoint", () => {
    const context = createAuthorizationContext([
      row({ permission_key: "task.read", scope_type: "department", department_id: departmentId }),
    ]);

    expect(hasPermission(context, "task.read")).toBe(true);
    expect(hasGlobalPermission(context, "task.read")).toBe(false);
    expect(hasGlobalPermission(createAuthorizationContext([row()]), "board.read")).toBe(true);
    expect(hasGlobalPermission(memberContext(), "user.read")).toBe(false);
  });

  it("requires department membership for department-scoped grants", () => {
    const member = createAuthorizationContext([row({ scope_type: "department" })]);
    const outsider = createAuthorizationContext([row({ department_ids: [], scope_type: "department" })]);

    expect(hasPermission(member, "board.read")).toBe(true);
    expect(hasPermissionScope(member, "board.read", { departmentId } )).toBe(true);
    expect(hasPermission(outsider, "board.read")).toBe(false);
    expect(hasPermissionScope(outsider, "board.read", { departmentId })).toBe(false);
  });

  it("limits owner, participation and explicit department grants to matching resources", () => {
    const context = createAuthorizationContext([
      row({ permission_key: "task.edit", scope_type: "own" }),
      row({ permission_key: "task.comment", scope_type: "participation" }),
      row({ permission_key: "task.move", scope_type: "department", department_id: departmentId }),
    ]);

    expect(hasPermissionScope(context, "task.edit", { ownerId: userId })).toBe(true);
    expect(hasPermissionScope(context, "task.edit", { ownerId: "another-user" })).toBe(false);
    expect(hasPermissionScope(context, "task.comment", { participantIds: [userId] })).toBe(true);
    expect(hasPermissionScope(context, "task.move", { departmentId })).toBe(true);
    expect(hasPermissionScope(context, "task.move", { departmentId: "another-department" })).toBe(false);
  });
});

function memberContext() {
  return createAuthorizationContext([
    row({ permission_key: "user.read", scope_type: "department", department_id: departmentId }),
  ]);
}
