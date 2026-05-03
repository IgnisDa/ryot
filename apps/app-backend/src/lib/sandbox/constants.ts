export const defaultMaxHeapMB = 256;
export const forceKillDelayMs = 500;
export const defaultTimeoutMs = 10_000;
export const requestBodyLimit = 128_000;
export const sandboxWorkerConcurrency = 5;
// Keep in sync with the `deno cache` step in the root Dockerfile runner stage.
export const vendoredPackages = ["npm:zod", "npm:dayjs", "npm:cheerio", "npm:youtubei.js"] as const;
