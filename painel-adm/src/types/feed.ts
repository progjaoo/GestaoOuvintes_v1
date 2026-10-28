export interface EditorialCategory {
  id: string;
  name: string;
  slug: string;
  active: boolean;
}

export interface EditorialMediaAsset {
  id: string;
  mediaType: "image" | "gif" | "video";
  mimeType: string;
  byteSize: number;
  status: "uploading" | "validating" | "ready" | "rejected";
  previewUrl?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  frameCount?: number | null;
  originalName?: string;
  createdAt?: string;
}

export interface EditorialRevision {
  id: string;
  revisionNumber: number;
  title: string;
  excerpt: string;
  slug?: string;
  categoryId?: string;
  coverAssetId: string;
  coverAlt: string;
  coverFocusX: number;
  coverFocusY: number;
  openingAssetId: string;
  openingAlt: string;
  openingFocusX: number;
  openingFocusY: number;
  blocks: EditorialBlock[];
  seoTitle: string;
  seoDescription: string;
  eventDate: string | null;
  publicCredits: string;
}

export interface EditorialPost {
  id: string;
  slug: string;
  status: "draft" | "published" | "archived";
  category?: { id: string; name: string; slug: string } | null;
  draftRevision: EditorialRevision | null;
  publishedRevision: EditorialRevision | null;
  firstPublishedAt: string | null;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface EditorialTextBlock extends Record<string, unknown> {
  id: string;
  type: "text";
  width: "reading" | "wide";
  content: Record<string, unknown>;
}

export type EditorialBlock = EditorialTextBlock | (Record<string, unknown> & {
  id: string;
  type: "image" | "gallery" | "video" | "gif" | "quote" | "divider";
});

export interface EditorialRevisionInput {
  title: string;
  excerpt: string;
  slug: string;
  categoryId: string;
  coverAssetId: string;
  coverAlt: string;
  coverFocusX: number;
  coverFocusY: number;
  openingAssetId: string;
  openingAlt: string;
  openingFocusX: number;
  openingFocusY: number;
  seoTitle: string;
  seoDescription: string;
  eventDate: string | null;
  publicCredits: string;
  blocks: EditorialBlock[];
}

export interface EditorialMediaPreview {
  url: string;
  posterUrl?: string | null;
  mediaType?: EditorialMediaAsset["mediaType"];
  mimeType?: string;
  expiresInSeconds: number;
}
