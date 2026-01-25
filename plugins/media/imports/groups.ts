import type { ImportEntityRef, ImportMediaEvent } from "./schemas";

export type ImportMediaEntityGroupBuilder = {
	entityRef: ImportEntityRef;
	itemIndex: number;
	events: ImportMediaEvent[];
	collectionMemberships: Array<{ collectionName: string }>;
	ownershipProvider?: string | undefined;
};

const importEntityRefKey = (ref: ImportEntityRef) =>
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
