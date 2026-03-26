export interface SaveFileInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}

export interface StoredFileResult {
  storageKey: string;
  publicUrl: string;
  sizeBytes: number;
  mimeType: string;
  originalName: string;
}

export interface StorageProvider {
  saveFile(input: SaveFileInput): Promise<StoredFileResult>;
  deleteFile(storageKey: string): Promise<void>;
  getPublicUrl(storageKey: string): string;
}
