import type { AppSchema } from "@ryot/ts-utils";

export interface AppEventSchema {
	id: string;
	name: string;
	slug: string;
	entitySchemaId: string;
	propertiesSchema: AppSchema;
}

export function sortEventSchemas(eventSchemas: AppEventSchema[]) {
	return [...eventSchemas].sort((a, b) => {
		if (a.name !== b.name) return a.name.localeCompare(b.name);
		return a.slug.localeCompare(b.slug);
	});
}

type EntityEventSchemaViewState =
	| { type: "empty" }
	| { type: "list"; eventSchemas: AppEventSchema[] };

export function getEntityEventSchemaViewState(
	eventSchemas: AppEventSchema[],
): EntityEventSchemaViewState {
	if (eventSchemas.length === 0) return { type: "empty" };

	return {
		type: "list",
		eventSchemas: sortEventSchemas(eventSchemas),
	};
}
