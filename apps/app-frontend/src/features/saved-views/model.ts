export interface SavedViewQueryDefinition {
	entitySchemaIds: string[];
}

export interface AppSavedView {
	id: string;
	name: string;
	isBuiltin: boolean;
	queryDefinition: SavedViewQueryDefinition;
}

export function toAppSavedView(raw: {
	id: string;
	name: string;
	isBuiltin: boolean;
	queryDefinition: unknown;
}): AppSavedView {
	return {
		id: raw.id,
		name: raw.name,
		isBuiltin: raw.isBuiltin,
		queryDefinition: raw.queryDefinition as SavedViewQueryDefinition,
	};
}

export function getSavedViewsForFacet(
	views: AppSavedView[],
	entitySchemaIds: string[],
): AppSavedView[] {
	const schemaIdSet = new Set(entitySchemaIds);

	return views.filter((view) =>
		view.queryDefinition.entitySchemaIds.some((id) => schemaIdSet.has(id)),
	);
}
