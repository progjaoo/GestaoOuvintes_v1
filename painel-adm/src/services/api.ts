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
} from "@/types/api";

const API_URL = (import.meta.env.VITE_CADASTROS_API_URL ?? "http://127.0.0.1:3010")
  .replace(/\/+$/, "");

export const UNAUTHORIZED_EVENT = "radio88-admin:unauthorized";

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

  listInstitutionalBanners() {
    return request<{ items: InstitutionalBanner[] }>(
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
};

export { API_URL, toQueryString };
