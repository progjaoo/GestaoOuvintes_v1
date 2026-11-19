export type AdminRole = "admin" | "viewer";
export type CampaignStatus = "draft" | "active" | "paused" | "closed";
export type CampaignType = "registration" | "sweepstake" | "engagement";

export interface AdminUser {
  id: string;
  name: string;
  username: string;
  email?: string | null;
  emailVerifiedAt?: string | null;
  role: AdminRole;
  active?: boolean;
  isSuperAdmin?: boolean;
  mustChangePassword?: boolean;
  lastLoginAt?: string | null;
  permissions?: string[];
}

export type AdminAccessScope = "global" | "own" | "participation" | "department";

export interface AdminRoleGrant {
  permissionKey: string;
  scopeType: AdminAccessScope;
  departmentId?: string | null;
  description?: string | null;
}

export interface ManagedAdminUser {
  id: string;
  name: string;
  username: string;
  email: string | null;
  email_verified_at: string | null;
  phone: string | null;
  active: boolean;
  is_super_admin: boolean;
  must_change_password?: boolean;
  role: AdminRole;
  version: number;
  created_at?: string;
  updated_at?: string;
  last_login_at: string | null;
  roles: Array<{ id: string; key: string; name: string }>;
  effectivePermissions?: Array<{ permission_key: string; scope_type: AdminAccessScope; department_id: string | null }>;
  overrides?: Array<{ permission_key: string; effect: "ALLOW" | "DENY"; scope_type: AdminAccessScope | null; department_id: string | null; reason: string; created_at: string }>;
  sessions?: Array<{ id: string; created_at: string; expires_at: string; revoked_at: string | null; revoke_reason: string | null }>;
}

export interface ManagedAdminRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
  version: number;
  updated_at?: string;
  user_count: number;
  grants: Array<AdminRoleGrant & { description?: string | null }>;
}

export interface AdminPermissionCatalogItem {
  key: string;
  description: string;
  role_grants: Array<{ roleId: string; roleKey: string; roleName: string; scopeType: AdminAccessScope; departmentId: string | null }>;
}

export interface AdminUserListResponse {
  items: ManagedAdminUser[];
  pagination: Pagination;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: string;
  user: AdminUser;
}

export interface BootstrapStatusResponse {
  canBootstrap: boolean;
}

export interface BootstrapAdminInput {
  name: string;
  username: string;
  password: string;
}

export interface Campaign {
  id: string;
  slug: string;
  name: string;
  title: string;
  description: string;
  status: CampaignStatus;
  type?: CampaignType;
  startsAt: string;
  endsAt: string | null;
  privacyNoticeVersion: string;
  privacyNoticeUrl: string;
  termsUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignPlacement {
  id: string;
  placementKey: string;
  campaignId: string | null;
  version: number;
  publishedAt: string | null;
  updatedAt: string;
  campaignName: string | null;
  campaignSlug: string | null;
  campaignStatus: CampaignStatus | null;
}

export interface RegistrationListItem {
  id: string;
  campaignId: string;
  campaignName: string;
  name: string;
  neighborhood: string;
  city: string;
  phone: string | null;
  source: string;
  marketingOptIn: boolean;
  createdAt: string;
}

export interface RegistrationDetail extends RegistrationListItem {
  privacyNoticeVersion: string;
  privacyAcknowledgedAt: string;
  marketingOptInAt: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: Pagination;
}

export type RegistrationSortBy = "createdAt" | "name" | "city";
export type SortDirection = "asc" | "desc";

export interface RegistrationFilters {
  page: number;
  pageSize: number;
  campaignId?: string;
  startDate?: string;
  endDate?: string;
  city?: string;
  neighborhood?: string;
  name?: string;
  q?: string;
  hasPhone?: boolean;
  sortBy?: RegistrationSortBy;
  sortDirection?: SortDirection;
}

export type CampaignSortBy = "createdAt" | "startsAt" | "endsAt" | "name";

export interface CampaignFilters {
  q?: string;
  status?: CampaignStatus;
  type?: CampaignType;
  startDate?: string;
  endDate?: string;
  activeToday?: boolean;
  sortBy?: CampaignSortBy;
  sortDirection?: SortDirection;
}

export interface CampaignInput {
  slug: string;
  name: string;
  title: string;
  description: string;
  status: CampaignStatus;
  type?: CampaignType;
  startsAt: string;
  endsAt?: string | null;
  privacyNoticeVersion: string;
  privacyNoticeUrl: string;
  termsUrl?: string | null;
}

export interface SweepstakeWinner {
  participationId: string;
  name: string;
  city: string;
  neighborhood: string;
  phone: string | null;
}

export interface SweepstakeDrawResponse {
  drawId: string;
  campaignId: string;
  sequence: number;
  eligibleCount: number;
  drawnAt: string;
  animationNames: string[];
  winner: SweepstakeWinner;
}

export interface SweepstakeStatusResponse {
  campaignId: string;
  campaignName: string;
  campaignStatus: CampaignStatus;
  campaignType: CampaignType;
  eligibleCount: number;
  legacyUnlinkedCount: number;
  canDraw: boolean;
  currentDraw: SweepstakeDrawResponse | null;
}

export interface ApiErrorPayload {
  statusCode: number;
  code: string;
  message: string;
  fields?: Array<{
    path: string;
    message: string;
  }>;
  details?: Record<string, unknown>;
}


export interface InstitutionalBannerAsset {
  id: string;
  imageUrl: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
}

export type InstitutionalBannerActionType =
  | "none"
  | "external_url"
  | "listener_registration_modal";

export interface InstitutionalBanner {
  id: string;
  title: string;
  altText: string;
  placementKey: string;
  mediaAssetId: string;
  actionType: InstitutionalBannerActionType;
  destinationUrl: string | null;
  openInNewTab: boolean;
  displayOrder: number;
  active: boolean;
  isPrimary?: boolean;
  imageUrl: string | null;
  objectKey: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface InstitutionalBannerInput {
  title: string;
  altText: string;
  placementKey: string;
  mediaAssetId: string;
  actionType: InstitutionalBannerActionType;
  destinationUrl: string | null;
  openInNewTab: boolean;
  active: boolean;
  isPrimary?: boolean;
}
