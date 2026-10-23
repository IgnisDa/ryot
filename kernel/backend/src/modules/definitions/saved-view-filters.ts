import type { FilterField } from "@ryot-app/contract/modules/filters/schemas";
import type { NamedQuery } from "@ryot-app/contract/modules/ryotql/language";
import type { KernelSavedViewRendererName } from "@ryot-app/contract/modules/saved-views/schemas";
import { reservedFilterFieldKeys } from "@ryot-app/ryotql-recipes/filters";

export const filterFieldIssues = ({
	query,
	renderer,
	settings,
}: {
	readonly query: NamedQuery;
	readonly renderer: KernelSavedViewRendererName;
	readonly settings: { readonly filterFields?: readonly FilterField[] | undefined };
}): string | undefined => {
	const projected = new Set(
		query.output.type === "rows"
			? query.output.fields.flatMap((selection) => ("key" in selection ? [selection.key] : []))
			: [],
	);
	const keys = new Set<string>();
	for (const filterField of settings.filterFields ?? []) {
		if (reservedFilterFieldKeys.includes(filterField.key)) {
			return `Filter field key '${filterField.key}' is reserved`;
		}
		if (keys.has(filterField.key)) {
			return `Filter field key '${filterField.key}' must be unique`;
		}
		keys.add(filterField.key);
		if (filterField.kind !== "value") {
			if (renderer === "results-table") {
				return `Filter field '${filterField.key}' cannot be a ${filterField.kind} on a results table`;
			}
			continue;
		}
		if (!projected.has(filterField.field)) {
			return `Filter field '${filterField.key}' must reference a projected scalar field`;
		}
		if ("choices" in filterField) {
			const values = filterField.choices.map(({ value }) => value);
			if (new Set(values).size !== values.length) {
				return `Filter field '${filterField.key}' choices must be unique`;
			}
		}
	}
	return undefined;
};
