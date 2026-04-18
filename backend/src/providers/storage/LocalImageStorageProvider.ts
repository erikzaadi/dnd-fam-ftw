import fs from 'fs';
import path from 'path';
import type { AppConfig } from '../../config/env.js';
import type { ImageStorageProvider, StoredImage } from './ImageStorageProvider.js';

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

  async deleteImage(key: string): Promise<void> {
    const filePath = path.join(this.storageDir, key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
