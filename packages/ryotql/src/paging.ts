import type { NamedQuery } from "@ryot-app/contract/modules/ryotql/authored";

export type QueryPaging = { readonly limit: number; readonly maxLimit: number };

export const queryPaging = ({ output }: NamedQuery): null | QueryPaging => {
	if (output.type === "rows") {
		return output.pagination;
	}
	if (!output.groupBy?.length || output.limit === undefined || output.maxLimit === undefined) {
		return null;
	}
	return { limit: output.limit, maxLimit: output.maxLimit };
};
