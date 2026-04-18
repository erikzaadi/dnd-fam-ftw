import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { AppConfig } from '../../config/env.js';
import type { ImageStorageProvider, StoredImage } from './ImageStorageProvider.js';

export class S3ImageStorageProvider implements ImageStorageProvider {
  private client: S3Client;
  private bucket: string;
  private prefix: string;
  private publicBaseUrl: string;

  constructor(config: AppConfig) {
    if (!config.S3_IMAGE_BUCKET) {
      throw new Error('[Config] S3_IMAGE_BUCKET is required for S3 image storage');
    }
    if (!config.AWS_REGION) {
      throw new Error('[Config] AWS_REGION is required for S3 image storage');
    }

    this.client = new S3Client({ region: config.AWS_REGION });
    this.bucket = config.S3_IMAGE_BUCKET;
    this.prefix = config.S3_IMAGE_PREFIX;

    const bucketBaseUrl = config.S3_IMAGE_PUBLIC_BASE_URL
      ?? `https://${this.bucket}.s3.${config.AWS_REGION}.amazonaws.com`;
    const prefixPath = this.prefix ? `/${this.prefix.replace(/\/$/, '')}` : '';
    this.publicBaseUrl = `${bucketBaseUrl.replace(/\/$/, '')}${prefixPath}`;
  }

  async validateSetup(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      console.log(`[S3Storage] Bucket access confirmed: ${this.bucket}`);
    } catch (err) {
      throw new Error(`[Config] Cannot access S3 bucket "${this.bucket}": ${String(err)}`, { cause: err });
    }
  }

  async putImage(input: { key: string; contentType: string; body: Buffer; cacheControl?: string }): Promise<StoredImage> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: `${this.prefix}${input.key}`,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: input.cacheControl,
    }));
    return { key: input.key, publicUrl: this.getPublicUrl(input.key) };
  }

  getPublicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: `${this.prefix}${key}` }));
      return true;
    } catch (err) {
      if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  async deleteImage(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: `${this.prefix}${key}`,
    }));
  }
}
