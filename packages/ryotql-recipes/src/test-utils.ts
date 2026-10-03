import type { NamedQuery, RowsResult } from "@ryot-app/contract/modules/ryotql/language";

export const rowsResult = (items: readonly unknown[], pageInfo: RowsResult["pageInfo"]) => ({
	items,
	pageInfo,
	type: "rows" as const,
});

export const rowsResponse = (
	queryName: string,
	items: readonly unknown[],
	pageInfo: RowsResult["pageInfo"],
) => ({ data: { [queryName]: rowsResult(items, pageInfo) } });

export const requireRowsQuery = (query: NamedQuery | undefined) => {
	if (query?.output.type !== "rows") {
		throw new Error("Expected rows query");
	}
	return { ...query, output: query.output };
};
