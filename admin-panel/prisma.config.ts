import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "prisma/config";

const cwd = process.cwd();
const rootLocalEnv = path.resolve(cwd, "../.env.local");
const rootEnv = path.resolve(cwd, "../.env");
const hasRootEnv = existsSync(rootLocalEnv) || existsSync(rootEnv);

if (hasRootEnv) {
  loadDotenv({ path: rootLocalEnv });
  loadDotenv({ path: rootEnv });
} else {
  loadDotenv({ path: path.resolve(cwd, ".env.local") });
  loadDotenv({ path: path.resolve(cwd, ".env") });
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL
  }
});
