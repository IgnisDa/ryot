export interface AppEntity {
	id: string;
	name: string;
	createdAt: Date;
	updatedAt: Date;
	entitySchemaId: string;
	externalId: string | null;
	properties: Record<string, unknown>;
	detailsSandboxScriptId: string | null;
}

export function sortEntities(entities: AppEntity[]) {
	return [...entities].sort((a, b) => {
		if (a.name !== b.name) return a.name.localeCompare(b.name);
		return a.createdAt.getTime() - b.createdAt.getTime();
	});
}

type EntityListViewState =
	| { type: "empty" }
	| { type: "list"; entities: AppEntity[] };

export function getEntityListViewState(
	entities: AppEntity[],
): EntityListViewState {
	if (entities.length === 0) return { type: "empty" };

	return {
		type: "list",
		entities: sortEntities(entities),
	};
}
