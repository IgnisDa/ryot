export interface SavedViewQueryDefinition {
	entitySchemaIds: string[];
}

export interface AppSavedView {
	id: string;
	icon: string;
	name: string;
	isBuiltin: boolean;
	accentColor: string;
	facetId: string | null;
	queryDefinition: SavedViewQueryDefinition;
}

export function toAppSavedView(raw: {
	id: string;
	icon: string;
	name: string;
	isBuiltin: boolean;
	accentColor: string;
	facetId: string | null;
	queryDefinition: unknown;
}): AppSavedView {
	return {
		id: raw.id,
		icon: raw.icon,
		name: raw.name,
		facetId: raw.facetId,
		isBuiltin: raw.isBuiltin,
		accentColor: raw.accentColor,
		queryDefinition: raw.queryDefinition as SavedViewQueryDefinition,
	};
}
