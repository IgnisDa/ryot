import type { ImportedMediaCopy, ImportEntityRef, ImportMediaEvent } from "./schemas";

export type ImportMediaEntityGroupBuilder = {
	itemIndex: number;
	entityRef: ImportEntityRef;
	events: ImportMediaEvent[];
	collectionMemberships: Array<{ collectionName: string }>;
	copies?: undefined | ReadonlyArray<typeof ImportedMediaCopy.Type>;
};

export const importEntityRefIdentifier = (ref: ImportEntityRef) =>
	ref.kind === "resolved" ? ref.externalId : ref.identifierValue;

export const importEntityRefKey = (ref: ImportEntityRef) =>
	ref.kind === "resolved"
		? `${ref.entitySchemaSlug}|${ref.providerSlug}|${ref.externalId}`
		: `${ref.entitySchemaSlug}|${ref.identifierType}|${ref.identifierValue}`;

export const getOrCreateMediaEntityGroup = (
	groupMap: Map<string, ImportMediaEntityGroupBuilder>,
	entityRef: ImportEntityRef,
	itemIndex: number,
) => {
	const key = importEntityRefKey(entityRef);
	let group = groupMap.get(key);
	if (!group) {
		group = { entityRef, itemIndex, events: [], collectionMemberships: [] };
		groupMap.set(key, group);
	}
	return group;
};
