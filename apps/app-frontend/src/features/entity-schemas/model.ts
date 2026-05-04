import type { AppSchema } from "@ryot/ts-utils";

import type { AppTracker } from "~/features/trackers/model";
import type { ApiPostResponseData } from "~/lib/api/types";

type ApiEntitySchema = ApiPostResponseData<"/entity-schemas/list">[number];

export type AppEntitySchema = Omit<ApiEntitySchema, "propertiesSchema"> & {
	propertiesSchema: AppSchema;
};

export function sortEntitySchemas(entitySchemas: AppEntitySchema[]): AppEntitySchema[] {
	return entitySchemas.toSorted((a, b) => {
		if (a.name !== b.name) {
			return a.name.localeCompare(b.name);
		}
		return a.slug.localeCompare(b.slug);
	});
}

type TrackerEntitySchemaViewState =
	| { type: "empty" }
	| { type: "list"; entitySchemas: AppEntitySchema[] };

export function getTrackerEntitySchemaViewState(input: {
	tracker: AppTracker;
	entitySchemas: AppEntitySchema[];
}): TrackerEntitySchemaViewState {
	if (input.entitySchemas.length === 0) {
		return { type: "empty" };
	}

	return {
		type: "list",
		entitySchemas: sortEntitySchemas(input.entitySchemas),
	};
}
