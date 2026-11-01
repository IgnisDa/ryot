import type { NamedQuery } from "@ryot-app/contract/modules/ryotql/language";
import type {
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
} from "@ryot-app/contract/modules/saved-views/schemas";

const projectedKeys = (query: NamedQuery) =>
	new Set(
		query.output.type === "rows"
			? query.output.fields.flatMap((selection) => ("key" in selection ? [selection.key] : []))
			: [],
	);

export const entityBrowserConfiguredFields = (settings: EntityBrowserSavedViewSettings) => [
	...settings.searchFields,
	...(settings.tableColumns?.map(({ field }) => field) ?? []),
	...(settings.summary.image === null ? [] : [settings.summary.image]),
	...(settings.summary.subtitle === null ? [] : [settings.summary.subtitle.field]),
];

export const resultsTableConfiguredFields = (settings: ResultsTableSavedViewSettings) => [
	...settings.rowKeyFields,
	...settings.columns.map(({ field }) => field),
];

export const unprojectedField = (query: NamedQuery, fields: readonly string[]) => {
	const projected = projectedKeys(query);
	return fields.find((field) => !projected.has(field));
};

export const filterFieldIssues = ({
	query,
	settings,
}: {
	readonly query: NamedQuery;
	readonly settings: ResultsTableSavedViewSettings;
}): string | undefined => {
	const projected = projectedKeys(query);
	const keys = new Set<string>();
	for (const filterField of settings.filterFields ?? []) {
		if (keys.has(filterField.key)) {
			return `Filter field key '${filterField.key}' must be unique`;
		}
		keys.add(filterField.key);
		if (filterField.kind !== "value") {
			return `Filter field '${filterField.key}' cannot be a ${filterField.kind} on a results table`;
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
