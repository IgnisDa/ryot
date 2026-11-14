import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import type { RyotQLDocument as ExecutableDocument } from "@ryot-app/contract/modules/ryotql/language";

export const historyRow = (
	document: RyotQLDocument | ExecutableDocument,
	category: number,
	row: Readonly<Record<string, unknown>>,
) => {
	const query = document.queries["history"];
	if (query?.output.type !== "rows") {
		throw new Error("Expected history rows");
	}
	return {
		...Object.fromEntries(
			query.output.fields.flatMap((field) => ("key" in field ? [[field.key, null]] : [])),
		),
		category: String(category),
		...Object.fromEntries(
			Object.entries(row).map(([key, value]) => [`category${category}_${key}`, value]),
		),
	};
};
