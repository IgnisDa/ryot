export const buildReorderedIds = <T extends string>(input: {
	readonly currentIds: ReadonlyArray<T>;
	readonly requestedIds: ReadonlyArray<T>;
}) => {
	const deduplicatedIds = [...new Set(input.requestedIds)];
	const requestedIdSet = new Set(deduplicatedIds);
	const trailingIds = input.currentIds.filter((itemId) => !requestedIdSet.has(itemId));

	return [...deduplicatedIds, ...trailingIds];
};
