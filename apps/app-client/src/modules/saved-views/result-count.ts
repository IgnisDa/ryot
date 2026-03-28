export const savedViewResultCount = (loaded: number, hasMore: boolean) =>
	`${loaded.toLocaleString()}${hasMore ? "+" : ""} ${loaded === 1 && !hasMore ? "result" : "results"}`;

export const savedViewLoadedCount = (loaded: number, hasMore: boolean) =>
	`${loaded.toLocaleString()}${hasMore ? "+" : ""} loaded`;
