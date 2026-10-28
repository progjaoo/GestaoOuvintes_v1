import type { EditorialCategory, EditorialRevisionInput } from "@/types/feed";

export interface FeedPreviewData { revision: EditorialRevisionInput; categories: EditorialCategory[] }

export function openFeedPreview(data: FeedPreviewData): boolean {
  const token = crypto.randomUUID();
  const channel = new BroadcastChannel(`feed-preview:${token}`);
  // Unsaved drafts stay in memory, never in URLs, localStorage or public buckets.
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (event.data === "ready") channel.postMessage(data);
  };
  const tab = window.open(`/conteudo/feed/previa/${token}`, "_blank");
  if (!tab) { channel.close(); return false; }
  tab.opener = null;
  window.setTimeout(() => channel.close(), 5 * 60 * 1000);
  return true;
}
