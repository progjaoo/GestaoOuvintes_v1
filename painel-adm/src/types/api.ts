export type AdminRole = "admin" | "viewer";
export type CampaignStatus = "draft" | "active" | "paused" | "closed";
export type CampaignType = "registration" | "sweepstake" | "engagement";

export interface AdminUser {
  id: string;
  name: string;
  username: string;
  role: AdminRole;
  active?: boolean;
  lastLoginAt?: string | null;
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

export interface RegistrationFilters {
  page: number;
  pageSize: number;
  campaignId?: string;
  startDate?: string;
  endDate?: string;
  city?: string;
  neighborhood?: string;
  name?: string;
  hasPhone?: boolean;
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

export interface InstitutionalBannerStorageStatus {
  driver: "disabled" | "r2";
  bucketName: string;
  objectPrefix: string;
  accountIdConfigured: boolean;
  accessKeyConfigured: boolean;
  secretKeyConfigured: boolean;
  publicBaseUrlConfigured: boolean;
  credentialsConfigured: boolean;
  diagnostics?: {
    accountIdTail: string | null;
    accessKeyIdTail: string | null;
    secretKeyFingerprint: string | null;
    publicBaseUrlHost: string | null;
    bucketNameFingerprint: string | null;
    objectPrefixFingerprint: string | null;
  };
  ready: boolean;
}

export interface InstitutionalBannerStorageWriteCheck {
  bucketName: string;
  objectPrefix: string;
  key: string;
  etag: string | null;
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

export interface InstitutionalBanner {
  id: string;
  title: string;
  altText: string;
  placementKey: string;
  mediaAssetId: string;
  destinationUrl: string | null;
  openInNewTab: boolean;
  displayOrder: number;
  active: boolean;
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
  destinationUrl: string | null;
  openInNewTab: boolean;
  active: boolean;
}
