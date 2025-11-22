import type { AppTracker } from "#/features/trackers/model";
import type { ApiGetResponseData } from "#/lib/api/types";

export type AppEntitySchema = ApiGetResponseData<"/entity-schemas">[number];

export function sortEntitySchemas(
	entitySchemas: AppEntitySchema[],
): AppEntitySchema[] {
	return [...entitySchemas].sort((a, b) => {
		if (a.name !== b.name) return a.name.localeCompare(b.name);
		return a.slug.localeCompare(b.slug);
	});
}

type TrackerEntitySchemaViewState =
	| { type: "builtin" }
	| { type: "empty" }
	| { type: "list"; entitySchemas: AppEntitySchema[] };

export function getTrackerEntitySchemaViewState(input: {
	tracker: AppTracker;
	entitySchemas: AppEntitySchema[];
}): TrackerEntitySchemaViewState {
	if (input.tracker.isBuiltin) return { type: "builtin" };
	if (input.entitySchemas.length === 0) return { type: "empty" };

	return {
		type: "list",
		entitySchemas: sortEntitySchemas(input.entitySchemas),
	};
}
