export type SavedViewCountState =
	| { readonly status: "idle" }
	| { readonly status: "failed" }
	| { readonly status: "counting" }
	| { readonly status: "resolved"; readonly total: number };

export const savedViewTotalCount = (loaded: number, total: number) =>
	`${loaded.toLocaleString()} of ${total.toLocaleString()} results`;

export const savedViewResultCount = (loaded: number, hasMore: boolean) =>
	`${loaded.toLocaleString()}${hasMore ? "+" : ""} ${loaded === 1 && !hasMore ? "result" : "results"}`;
