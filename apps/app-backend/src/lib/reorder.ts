export const buildReorderedIds = (input: {
	readonly currentIds: ReadonlyArray<string>;
	readonly requestedIds: ReadonlyArray<string>;
}) => {
	const requestedIds = [...new Set(input.requestedIds)];
	const requestedIdSet = new Set(requestedIds);
	const trailingIds = input.currentIds.filter((itemId) => !requestedIdSet.has(itemId));

	return [...requestedIds, ...trailingIds];
};
