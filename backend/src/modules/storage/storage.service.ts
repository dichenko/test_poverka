import { env } from "../../config/env";
import { LocalStorageProvider } from "./local-storage.provider";
import type { StorageProvider } from "./storage.types";

let provider: StorageProvider;

export function getStorageProvider(): StorageProvider {
  if (!provider) {
    if (env.STORAGE_PROVIDER === "local") {
      provider = new LocalStorageProvider();
    } else {
      throw new Error(`Unknown storage provider: ${env.STORAGE_PROVIDER}`);
    }
  }
  return provider;
}
