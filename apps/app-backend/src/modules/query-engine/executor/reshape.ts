import type { IncludeEntry, RowItem, RowValue } from "@ryot/contract/modules/query-engine/language";
import { isObjectRecord } from "@ryot/ts-utils/predicates";

import { reconstructRowItem } from "./compile/select-list";

// Turns the `<key>__inc` jsonb arrays produced by the include LATERALs into IncludedRowsValue trees.
// Each array element is an object of `<field>__v`/`<field>__k` pairs plus nested `<key>__inc` arrays;
// hasMore is derived from the limit+1 fetch, and items are sliced back to the requested limit.
export const reconstructIncludes = (
	row: Record<string, unknown>,
	includes: readonly IncludeEntry[],
): Record<string, RowValue> => {
	const values: Record<string, RowValue> = {};
	for (const include of includes) {
		const raw = row[`${include.key}__inc`];
		const elements = Array.isArray(raw) ? raw : [];
		const items: RowItem[] = elements.slice(0, include.limit).map((element) => {
			const record = isObjectRecord(element) ? element : {};
			const item = reconstructRowItem(record, include.fields);
			Object.assign(item, reconstructIncludes(record, include.include ?? []));
			return item;
		});
		values[include.key] = {
			items,
			pageInfo: { limit: include.limit, hasMore: elements.length > include.limit },
		};
	}
	return values;
};
