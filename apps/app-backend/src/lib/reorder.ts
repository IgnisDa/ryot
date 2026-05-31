export const buildReorderedIds = (input: {
	readonly currentIds: ReadonlyArray<string>;
	readonly requestedIds: ReadonlyArray<string>;
}) => {
	const deduplicatedIds = [...new Set(input.requestedIds)];
	const requestedIdSet = new Set(deduplicatedIds);
	const trailingIds = input.currentIds.filter((itemId) => !requestedIdSet.has(itemId));

	return [...deduplicatedIds, ...trailingIds];
};
