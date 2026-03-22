export interface AppEntity {
	id: string;
	name: string;
	image: AppEntityImage;
	createdAt: Date;
	updatedAt: Date;
	entitySchemaId: string;
	externalId: string | null;
	properties: Record<string, unknown>;
	detailsSandboxScriptId: string | null;
}

export type AppEntityImage =
	| { kind: "s3"; key: string }
	| { kind: "remote"; url: string }
	| null;

function toAppEntityImage(image: unknown): AppEntityImage {
	if (!image || typeof image !== "object") return null;

	const parsed = image as { kind?: string; key?: string; url?: string };

	if (parsed.kind === "remote" && parsed.url)
		return { kind: "remote", url: parsed.url };

	if (parsed.kind === "s3" && parsed.key)
		return { kind: "s3", key: parsed.key };

	return null;
}

export function toAppEntity(
	entity: Omit<AppEntity, "createdAt" | "updatedAt" | "image"> & {
		image: unknown;
		createdAt: string;
		updatedAt: string;
	},
): AppEntity {
	return {
		...entity,
		image: toAppEntityImage(entity.image),
		createdAt: new Date(entity.createdAt),
		updatedAt: new Date(entity.updatedAt),
	};
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
