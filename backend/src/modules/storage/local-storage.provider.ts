import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { env } from "../../config/env";
import type { SaveFileInput, StorageProvider } from "./storage.types";

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const maxBytes = 10 * 1024 * 1024;

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "file";
}

export class LocalStorageProvider implements StorageProvider {
  async saveFile(input: SaveFileInput) {
    if (!allowedMimeTypes.has(input.mimeType)) {
      throw new Error("Unsupported mime type.");
    }
    if (input.buffer.length > maxBytes) {
      throw new Error("File is too large.");
    }

    const safeName = sanitizeFileName(input.originalName);
    const ext = path.extname(safeName);
    const randomId = crypto.randomUUID();
    const storageKey = `${randomId}${ext}`;

    const baseDir = path.resolve(env.STORAGE_LOCAL_PATH);
    await fs.mkdir(baseDir, { recursive: true });
    const absolutePath = path.join(baseDir, storageKey);
    await fs.writeFile(absolutePath, input.buffer);

    return {
      storageKey,
      publicUrl: this.getPublicUrl(storageKey),
      sizeBytes: input.buffer.length,
      mimeType: input.mimeType,
      originalName: safeName
    };
  }

  async deleteFile(storageKey: string) {
    const baseDir = path.resolve(env.STORAGE_LOCAL_PATH);
    const absolutePath = path.resolve(path.join(baseDir, storageKey));
    if (!absolutePath.startsWith(baseDir)) {
      throw new Error("Unsafe storage path.");
    }
    await fs.rm(absolutePath, { force: true });
  }

  getPublicUrl(storageKey: string) {
    return `${env.STORAGE_PUBLIC_BASE_URL.replace(/\/$/, "")}/${storageKey}`;
  }
}
