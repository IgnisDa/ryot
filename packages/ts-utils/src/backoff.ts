export const exponentialBackoffMs = (attempt: number, maxMs: number, baseMs = 1_000) =>
	Math.min(maxMs, baseMs * 2 ** (attempt - 1));
