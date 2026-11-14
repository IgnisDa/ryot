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
