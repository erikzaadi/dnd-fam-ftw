export type AppConfig = {
  SQLITE_DB_PATH: string;
  IMAGE_STORAGE_PROVIDER: 'local' | 's3';
  LOCAL_IMAGE_STORAGE_PATH: string;
  LOCAL_IMAGE_PUBLIC_BASE_URL: string;
  AWS_REGION?: string;
  S3_IMAGE_BUCKET?: string;
  S3_IMAGE_PREFIX: string;
  S3_IMAGE_PUBLIC_BASE_URL?: string;
  // Auth (optional - if absent, auth is disabled)
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_CALLBACK_URL?: string;
  JWT_SECRET?: string;
  ADMIN_EMAIL?: string;
  FRONTEND_URL?: string;
  APP_BASE_PATH: string;
  APP_VERSION: string;
};

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = parse();
  }
  return _config;
}

export function isAuthEnabled(): boolean {
  const c = getConfig();
  return !!(c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET && c.JWT_SECRET);
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
    LOCAL_IMAGE_PUBLIC_BASE_URL: process.env.LOCAL_IMAGE_PUBLIC_BASE_URL ?? '/generated',
    AWS_REGION: process.env.AWS_REGION,
    S3_IMAGE_BUCKET: process.env.S3_IMAGE_BUCKET,
    S3_IMAGE_PREFIX: process.env.S3_IMAGE_PREFIX ?? 'generated/',
    S3_IMAGE_PUBLIC_BASE_URL: process.env.S3_IMAGE_PUBLIC_BASE_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    FRONTEND_URL: process.env.FRONTEND_URL ?? '',
    APP_BASE_PATH: process.env.APP_BASE_PATH ?? '/dnd-fam-ftw/',
    APP_VERSION: process.env.APP_VERSION ?? 'dev',
  };
}
