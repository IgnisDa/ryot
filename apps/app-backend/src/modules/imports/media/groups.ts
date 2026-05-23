import { importEntityRefKey, type ImportEntityRef, type ImportMediaEntityGroup } from "../jobs";

export const getOrCreateMediaEntityGroup = (
	groupMap: Map<string, ImportMediaEntityGroup>,
	entityRef: ImportEntityRef,
): ImportMediaEntityGroup => {
	const key = importEntityRefKey(entityRef);
	let group = groupMap.get(key);
	if (!group) {
		group = { entityRef, events: [], collectionMemberships: [] };
		groupMap.set(key, group);
	}
	return group;
};
