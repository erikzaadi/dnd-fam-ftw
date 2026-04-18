import { getConfig } from '../../config/env.js';
import { LocalImageStorageProvider } from './LocalImageStorageProvider.js';
import { S3ImageStorageProvider } from './S3ImageStorageProvider.js';
import type { ImageStorageProvider } from './ImageStorageProvider.js';

let _provider: ImageStorageProvider | null = null;

export function getImageStorageProvider(): ImageStorageProvider {
  if (!_provider) {
    const config = getConfig();
    if (config.IMAGE_STORAGE_PROVIDER === 's3') {
      _provider = new S3ImageStorageProvider(config);
    } else {
      _provider = new LocalImageStorageProvider(config);
    }
    console.log(`[Storage] Image provider: ${config.IMAGE_STORAGE_PROVIDER}`);
  }
  return _provider;
}
