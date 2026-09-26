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

  // Bytes of a stored image, or null when it does not exist. For authorized server-side
  // delivery (MCP get_scene_image); never exposes storage paths or credentials.
  getImage(key: string): Promise<{ body: Buffer; contentType: string } | null>;

  validateSetup?(): Promise<void>;
}
