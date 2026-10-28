export function feedPublicPostUrl(base: string | undefined, slug: string): string | null {
  if (!base || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  try {
    const url = new URL(base);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}/feed/${slug}`;
  } catch {
    return null;
  }
}
