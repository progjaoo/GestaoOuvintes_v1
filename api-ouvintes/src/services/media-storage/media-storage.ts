export interface MediaStorage {
  put(input: {
    key: string;
    body: Buffer;
    contentType: string;
    cacheControl: string;
  }): Promise<{ etag: string | null }>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}
