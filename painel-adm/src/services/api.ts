import { getAccessToken } from "@/services/session";
import type {
  AdminUser,
  ApiErrorPayload,
  BootstrapAdminInput,
  BootstrapStatusResponse,
  Campaign,
  CampaignInput,
  CampaignPlacement,
  CampaignFilters,
  LoginResponse,
  PaginatedResponse,
  RegistrationDetail,
  RegistrationFilters,
  RegistrationListItem,
  InstitutionalBanner,
  InstitutionalBannerAsset,
  InstitutionalBannerInput,
  SweepstakeDrawResponse,
  SweepstakeStatusResponse,
} from "@/types/api";
import type { EditorialCategory, EditorialMediaAsset, EditorialMediaPreview, EditorialPost, EditorialRevisionInput } from "@/types/feed";

const API_URL = (import.meta.env.VITE_CADASTROS_API_URL ?? "http://127.0.0.1:3010")
  .replace(/\/+$/, "");

export const UNAUTHORIZED_EVENT = "radio88-admin:unauthorized";
export const PUBLIC_CONFIG_SYNC_EVENT = "radio88-admin:public-config-sync";
export const PUBLIC_CONFIG_SYNC_STORAGE_KEY = "radio88-admin:public-config-sync-pending";
let publicConfigSyncPending: boolean | null = null;

export function getPublicConfigSyncPending(): boolean | null {
  return publicConfigSyncPending;
}

function capturePublicConfigSync(response: Response) {
  const status = response.headers.get("x-public-config-sync");
  if (!status || typeof window === "undefined") return;

  const state =
    status === "pending"
      ? { pending: true, revision: response.headers.get("x-public-config-revision") }
      : status === "published" || status === "disabled"
        ? { pending: false, revision: null }
        : null;
  if (!state) return;

  publicConfigSyncPending = state.pending;

  try {
    if (state.pending) {
      window.localStorage.setItem(PUBLIC_CONFIG_SYNC_STORAGE_KEY, JSON.stringify(state));
    } else {
      window.localStorage.removeItem(PUBLIC_CONFIG_SYNC_STORAGE_KEY);
    }
  } catch {
    // The in-memory state and event still notify the active panel when storage is blocked.
  }

  window.dispatchEvent(new CustomEvent(PUBLIC_CONFIG_SYNC_EVENT, { detail: state }));
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: ApiErrorPayload["fields"],
    public readonly details?: ApiErrorPayload["details"],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions extends RequestInit {
  authenticated?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (options.authenticated !== false) {
    const token = getAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Não foi possível conectar à API de cadastros.",
    );
  }

  capturePublicConfigSync(response);

  if (response.status === 401 && options.authenticated !== false) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    throw new ApiError(
      response.status,
      payload?.code ?? "REQUEST_FAILED",
      payload?.message ?? "Não foi possível concluir a operação.",
      payload?.fields,
      payload?.details,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function toQueryString(params: object): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    query.set(key, String(value));
  }

  const result = query.toString();
  return result ? `?${result}` : "";
}

async function download(path: string, fallbackName: string): Promise<void> {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    throw new ApiError(
      response.status,
      payload?.code ?? "EXPORT_FAILED",
      payload?.message ?? "Não foi possível gerar a exportação.",
    );
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition");
  const fileName = disposition?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  republishPublicConfig() {
    return request<{ syncStatus: "published" | "pending" | "disabled"; revision: string | null }>(
      "/api/admin/public-config/republish",
      { method: "POST" },
    );
  },

  getBootstrapStatus() {
    return request<BootstrapStatusResponse>("/api/admin/auth/bootstrap-status", {
      authenticated: false,
    });
  },

  bootstrapAdmin(input: BootstrapAdminInput) {
    return request<LoginResponse>("/api/admin/auth/bootstrap", {
      method: "POST",
      authenticated: false,
      body: JSON.stringify(input),
    });
  },

  login(username: string, password: string) {
    return request<LoginResponse>("/api/admin/auth/login", {
      method: "POST",
      authenticated: false,
      body: JSON.stringify({ username, password }),
    });
  },

  me() {
    return request<{ user: AdminUser }>("/api/admin/auth/me");
  },

  logout() {
    return request<void>("/api/admin/auth/logout", { method: "POST" });
  },

  listCampaigns(filters: CampaignFilters = {}) {
    return request<{ items: Campaign[] }>(`/api/admin/campaigns${toQueryString(filters)}`);
  },

  listCampaignPlacements() {
    return request<{ items: CampaignPlacement[] }>(
      "/api/admin/campaigns/placements/list",
    );
  },

  createCampaign(input: CampaignInput) {
    return request<Campaign>("/api/admin/campaigns", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  updateCampaign(id: string, input: Partial<CampaignInput>) {
    return request<Campaign>(`/api/admin/campaigns/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  publishCampaign(id: string, placementKey = "institutional_modal") {
    return request<{ placementKey: string; campaignId: string; version: number }>(
      `/api/admin/campaigns/${id}/publish`,
      {
        method: "POST",
        body: JSON.stringify({ placementKey }),
      },
    );
  },

  getSweepstakeStatus(campaignId: string) {
    return request<SweepstakeStatusResponse>(
      `/api/admin/sweepstakes/${campaignId}/status`,
    );
  },

  drawSweepstake(campaignId: string, requestToken: string) {
    return request<SweepstakeDrawResponse>(
      `/api/admin/sweepstakes/${campaignId}/draw`,
      {
        method: "POST",
        headers: { "Idempotency-Key": requestToken },
      },
    );
  },

  redrawSweepstake(
    campaignId: string,
    previousDrawId: string,
    requestToken: string,
  ) {
    return request<SweepstakeDrawResponse>(
      `/api/admin/sweepstakes/${campaignId}/redraw`,
      {
        method: "POST",
        headers: { "Idempotency-Key": requestToken },
        body: JSON.stringify({ previousDrawId }),
      },
    );
  },

  listInstitutionalBanners() {
    return request<{ items: InstitutionalBanner[]; capabilities?: { primaryBanner: boolean } }>(
      "/api/admin/institutional-banners?placement=home_hero",
    );
  },


  uploadInstitutionalBannerAsset(file: File) {
    const body = new FormData();
    body.append("file", file);
    return request<InstitutionalBannerAsset>("/api/admin/institutional-banners/assets", {
      method: "POST",
      body,
    });
  },

  createInstitutionalBanner(input: InstitutionalBannerInput) {
    return request<InstitutionalBanner>("/api/admin/institutional-banners", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  updateInstitutionalBanner(id: string, input: Partial<InstitutionalBannerInput>) {
    return request<InstitutionalBanner>("/api/admin/institutional-banners/" + id, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  setInstitutionalBannerActive(id: string, active: boolean) {
    return request<InstitutionalBanner>(
      "/api/admin/institutional-banners/" + id + (active ? "/activate" : "/deactivate"),
      { method: "POST" },
    );
  },

  reorderInstitutionalBanners(orderedIds: string[]) {
    return request<void>("/api/admin/institutional-banners/reorder", {
      method: "PUT",
      body: JSON.stringify({ placementKey: "home_hero", orderedIds }),
    });
  },

  deleteInstitutionalBanner(id: string) {
    return request<void>("/api/admin/institutional-banners/" + id, { method: "DELETE" });
  },

  listRegistrations(filters: RegistrationFilters) {
    return request<PaginatedResponse<RegistrationListItem>>(
      `/api/admin/listener-registrations${toQueryString(filters)}`,
    );
  },

  getRegistration(id: string) {
    return request<RegistrationDetail>(
      `/api/admin/listener-registrations/${id}`,
    );
  },

  exportRegistrations(
    format: "csv" | "xlsx",
    filters: Omit<RegistrationFilters, "page" | "pageSize">,
  ) {
    const query = toQueryString({ ...filters, format });
    return download(
      `/api/admin/listener-registrations/export${query}`,
      `cadastros-radio88.${format}`,
    );
  },

  listFeedCategories() {
    return request<{ items: EditorialCategory[] }>("/api/admin/feed/categories");
  },

  createFeedCategory(input: { name: string; slug: string }) {
    return request<EditorialCategory>("/api/admin/feed/categories", { method: "POST", body: JSON.stringify(input) });
  },

  updateFeedCategory(id: string, input: Partial<{ name: string; slug: string; active: boolean }>) {
    return request<EditorialCategory>(`/api/admin/feed/categories/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  },

  listFeedPosts(params: { page?: number; pageSize?: number; status?: "draft" | "published" | "archived" | "all"; q?: string; categoryId?: string } = {}) {
    return request<{ items: EditorialPost[]; page: number; pageSize: number; total: number }>(`/api/admin/feed/posts${toQueryString(params)}`);
  },

  getFeedPost(id: string) {
    return request<EditorialPost>(`/api/admin/feed/posts/${id}`);
  },

  createFeedDraft(revision: EditorialRevisionInput) {
    return request<{ id: string; revisionId: string; revisionNumber: number }>("/api/admin/feed/posts", {
      method: "POST",
      body: JSON.stringify({ revision }),
    });
  },

  updateFeedDraft(postId: string, expectedVersion: number, revision: EditorialRevisionInput) {
    return request<{ id: string; revisionId: string; revisionNumber: number }>(`/api/admin/feed/posts/${postId}`, {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion, revision }),
    });
  },

  listFeedAssets(params: { page?: number; pageSize?: number } = {}) {
    return request<{ items: EditorialMediaAsset[]; page: number; pageSize: number }>(`/api/admin/feed/assets${toQueryString(params)}`);
  },

  getFeedAssetPreview(id: string) {
    return request<EditorialMediaPreview>(`/api/admin/feed/assets/${id}/preview`);
  },

  publishFeedPost(postId: string, revisionId: string) {
    const idempotencyKey = crypto.randomUUID();
    return request<{ releaseId: string; status: string; duplicate: boolean }>(`/api/admin/feed/posts/${postId}/publish`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ revisionId, idempotencyKey }),
    });
  },

  async uploadFeedAsset(file: File, mediaType: "image" | "gif" | "video", onProgress?: (progress: number) => void, signal?: AbortSignal) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const checksumSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const upload = await request<{ asset: EditorialMediaAsset; uploadUrl: string; requiredHeaders: Record<string, string> }>("/api/admin/feed/assets/uploads", {
      method: "POST",
      body: JSON.stringify({ mediaType, mimeType: file.type, byteSize: file.size, filename: file.name, checksumSha256 }),
    });
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      xhr.open("PUT", upload.uploadUrl);
      xhr.withCredentials = false;
      for (const [name, value] of Object.entries(upload.requiredHeaders)) xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        signal?.removeEventListener("abort", abort);
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new ApiError(xhr.status, "FEED_UPLOAD_FAILED", "Não foi possível enviar a mídia ao armazenamento privado de Preview."));
      };
      xhr.onerror = () => {
        signal?.removeEventListener("abort", abort);
        reject(new ApiError(0, "FEED_UPLOAD_CORS_OR_NETWORK", "O envio ao R2 falhou. Verifique o CORS do bucket privado para a origem deste painel e tente novamente."));
      };
      xhr.onabort = () => {
        signal?.removeEventListener("abort", abort);
        reject(new ApiError(0, "FEED_UPLOAD_ABORTED", "O envio da mídia foi cancelado."));
      };
      if (signal?.aborted) {
        reject(new ApiError(0, "FEED_UPLOAD_ABORTED", "O envio da mídia foi cancelado."));
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      xhr.send(file);
    });
    onProgress?.(100);
    return request<EditorialMediaAsset>(`/api/admin/feed/assets/${upload.asset.id}/complete`, { method: "POST" });
  },

  archiveFeedPost(postId: string, revisionId: string) {
    const idempotencyKey = crypto.randomUUID();
    return request<{ releaseId: string; status: string; duplicate: boolean }>(`/api/admin/feed/posts/${postId}/archive`, {
      method: "POST",
      body: JSON.stringify({ revisionId, idempotencyKey }),
    });
  },

  checkFeedRelease(releaseId: string) {
    return request<{ id: string; status: string; live: boolean }>(`/api/admin/feed/releases/${releaseId}/check`, { method: "POST" });
  },

  getFeedRelease(releaseId: string) {
    return request<{ id: string; status: string; errorCode?: string | null; updatedAt: string }>(`/api/admin/feed/releases/${releaseId}`);
  },

  retryFeedRelease(releaseId: string) {
    return request<{ releaseId: string; status: string }>(`/api/admin/feed/releases/${releaseId}/retry`, { method: "POST" });
  },
};

export { API_URL, toQueryString };
