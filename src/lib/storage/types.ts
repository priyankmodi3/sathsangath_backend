/** Provider-agnostic object storage. Implement this to add a new backend (e.g. GCS). */
export interface StorageProvider {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Time-limited GET link for a private object. */
  signedUrl(key: string, expiresInSec: number): Promise<string>;
}
