import fs from 'fs';
import path from 'path';
import type { AppConfig } from '../../config/env.js';
import type { ImageStorageProvider, StoredImage } from './ImageStorageProvider.js';

const CONTENT_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };

export const contentTypeFor = (key: string): string => CONTENT_TYPES[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

export class LocalImageStorageProvider implements ImageStorageProvider {
  private storageDir: string;
  private publicBaseUrl: string;

  constructor(config: AppConfig) {
    this.storageDir = path.resolve(config.LOCAL_IMAGE_STORAGE_PATH);
    this.publicBaseUrl = config.LOCAL_IMAGE_PUBLIC_BASE_URL.replace(/\/$/, '');
  }

  async putImage(input: { key: string; contentType: string; body: Buffer; cacheControl?: string }): Promise<StoredImage> {
    fs.mkdirSync(this.storageDir, { recursive: true });
    fs.writeFileSync(path.join(this.storageDir, input.key), input.body);
    return { key: input.key, publicUrl: this.getPublicUrl(input.key) };
  }

  getPublicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(path.join(this.storageDir, key));
  }

  async getImage(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const filePath = path.resolve(this.storageDir, key);
    // Keys come from the database, but never read outside the storage folder.
    if (!filePath.startsWith(this.storageDir + path.sep) || !fs.existsSync(filePath)) {
      return null;
    }
    return { body: fs.readFileSync(filePath), contentType: contentTypeFor(key) };
  }

  async deleteImage(key: string): Promise<void> {
    const filePath = path.join(this.storageDir, key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
