export type StoredImage = {
  key: string;
  publicUrl: string;
};

export interface ImageStorageProvider {
  putImage(input: {
    key: string;
    contentType: string;
    body: Buffer;
    cacheControl?: string;
  }): Promise<StoredImage>;

  getPublicUrl(key: string): string;

  exists(key: string): Promise<boolean>;

  deleteImage(key: string): Promise<void>;

  validateSetup?(): Promise<void>;
}
