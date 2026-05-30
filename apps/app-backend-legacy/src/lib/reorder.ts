export const buildReorderedIds = (input: { currentIds: string[]; requestedIds: string[] }) => {
	const requestedIds = [...new Set(input.requestedIds)];
	const requestedIdSet = new Set(requestedIds);
	const trailingIds = input.currentIds.filter((itemId) => !requestedIdSet.has(itemId));

	return [...requestedIds, ...trailingIds];
};
