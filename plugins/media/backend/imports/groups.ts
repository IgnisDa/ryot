import type { ImportEntityRef, ImportMediaEvent } from "./schemas";

export type ImportMediaEntityGroupBuilder = {
	itemIndex: number;
	entityRef: ImportEntityRef;
	events: ImportMediaEvent[];
	ownershipProvider?: string | undefined;
	collectionMemberships: Array<{ collectionName: string }>;
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
