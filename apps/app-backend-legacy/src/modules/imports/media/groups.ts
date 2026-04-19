import { importEntityRefKey, type ImportEntityRef, type ImportMediaEntityGroup } from "../jobs";

export const getOrCreateMediaEntityGroup = (
	groupMap: Map<string, ImportMediaEntityGroup>,
	entityRef: ImportEntityRef,
	itemIndex?: number,
): ImportMediaEntityGroup => {
	const key = importEntityRefKey(entityRef);
	let group = groupMap.get(key);
	if (!group) {
		group = { entityRef, itemIndex, events: [], collectionMemberships: [] };
		groupMap.set(key, group);
	}
	return group;
};

export const mediaEntityGroupItemIndex = (
	group: ImportMediaEntityGroup | undefined,
	fallbackIndex: number,
) => group?.itemIndex ?? fallbackIndex;
