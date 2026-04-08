import path from "path";
import { buildReportPublicUrl } from "./report-public-url";

export interface ReportPaths {
  baseDir: string;
  reportDir: string;
  fileName: string;
  absolutePath: string;
  publicUrl: string;
}

interface BuildReportPathsInput {
  storageDir: string;
  publicBaseUrl: string;
  publicToken?: string;
  reportCode: string;
  pathSegments?: string[];
  fileName: string;
}

export function buildReportPaths(input: BuildReportPathsInput): ReportPaths {
  const baseDir = path.resolve(input.storageDir);
  const pathSegments = input.pathSegments ?? [];
  for (const segment of pathSegments) {
    if (!segment || segment.includes("/") || segment.includes("\\") || segment === "." || segment === "..") {
      throw new Error(`Unsafe report path segment: "${segment}"`);
    }
  }

  const reportDir = path.resolve(baseDir, input.reportCode, ...pathSegments);
  const absolutePath = path.resolve(reportDir, input.fileName);
  const relative = path.relative(baseDir, absolutePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe report path outside storage root: ${absolutePath}`);
  }

  const publicUrl = input.publicToken
    ? buildReportPublicUrl({
        publicBaseUrl: input.publicBaseUrl,
        publicToken: input.publicToken
      })
    : `${input.publicBaseUrl.replace(/\/+$/, "")}/${[input.reportCode, ...pathSegments, input.fileName]
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`;

  return {
    baseDir,
    reportDir,
    fileName: input.fileName,
    absolutePath,
    publicUrl
  };
}
