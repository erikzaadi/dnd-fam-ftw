export type AppConfig = {
  SQLITE_DB_PATH: string;
  IMAGE_STORAGE_PROVIDER: 'local' | 's3';
  LOCAL_IMAGE_STORAGE_PATH: string;
  LOCAL_IMAGE_PUBLIC_BASE_URL: string;
  AWS_REGION?: string;
  S3_IMAGE_BUCKET?: string;
  S3_IMAGE_PREFIX: string;
  S3_IMAGE_PUBLIC_BASE_URL?: string;
};

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = parse();
  }
  return _config;
}

function parse(): AppConfig {
  const IMAGE_STORAGE_PROVIDER = process.env.IMAGE_STORAGE_PROVIDER ?? 'local';
  if (IMAGE_STORAGE_PROVIDER !== 'local' && IMAGE_STORAGE_PROVIDER !== 's3') {
    throw new Error(`[Config] Invalid IMAGE_STORAGE_PROVIDER: "${IMAGE_STORAGE_PROVIDER}". Must be "local" or "s3".`);
  }
  return {
    SQLITE_DB_PATH: process.env.SQLITE_DB_PATH ?? './data/dnd-fam-ftw.sqlite',
    IMAGE_STORAGE_PROVIDER: IMAGE_STORAGE_PROVIDER as 'local' | 's3',
    LOCAL_IMAGE_STORAGE_PATH: process.env.LOCAL_IMAGE_STORAGE_PATH ?? './data/generated-images',
    LOCAL_IMAGE_PUBLIC_BASE_URL: process.env.LOCAL_IMAGE_PUBLIC_BASE_URL ?? '/api/generated',
    AWS_REGION: process.env.AWS_REGION,
    S3_IMAGE_BUCKET: process.env.S3_IMAGE_BUCKET,
    S3_IMAGE_PREFIX: process.env.S3_IMAGE_PREFIX ?? 'generated/',
    S3_IMAGE_PUBLIC_BASE_URL: process.env.S3_IMAGE_PUBLIC_BASE_URL,
  };
}
