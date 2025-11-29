import type { ApiPostResponseData } from "#/lib/api/types";

type ApiEntity = ApiPostResponseData<"/view-runtime/execute">[number];

export type AppEntityImage =
	| { kind: "remote"; url: string }
	| { kind: "s3"; key: string }
	| null;

export type AppEntity = Omit<ApiEntity, "createdAt" | "updatedAt" | "image"> & {
	image: AppEntityImage;
	createdAt: Date;
	updatedAt: Date;
};

function toAppEntityImage(image: unknown): AppEntityImage {
	if (!image || typeof image !== "object") return null;

	const parsed = image as { kind?: string; key?: string; url?: string };

	if (parsed.kind === "remote" && parsed.url)
		return { kind: "remote", url: parsed.url };

	if (parsed.kind === "s3" && parsed.key)
		return { kind: "s3", key: parsed.key };

	return null;
}

export function toAppEntity(entity: ApiEntity): AppEntity {
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
