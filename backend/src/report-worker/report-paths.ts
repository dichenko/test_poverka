import path from "path";

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
  reportCode: string;
  fileName: string;
}

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

export function buildReportPaths(input: BuildReportPathsInput): ReportPaths {
  const baseDir = path.resolve(input.storageDir);
  const reportDir = path.resolve(baseDir, input.reportCode);
  const absolutePath = path.resolve(reportDir, input.fileName);
  const relative = path.relative(baseDir, absolutePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe report path outside storage root: ${absolutePath}`);
  }

  const publicUrl = `${trimTrailingSlashes(input.publicBaseUrl)}/${encodeURIComponent(input.reportCode)}/${encodeURIComponent(
    input.fileName
  )}`;

  return {
    baseDir,
    reportDir,
    fileName: input.fileName,
    absolutePath,
    publicUrl
  };
}

