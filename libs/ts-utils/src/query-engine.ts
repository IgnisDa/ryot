export function getQueryEngineField<T extends { key: string }>(
	item: readonly T[] | undefined,
	key: string,
): T | undefined {
	return item?.find((field) => field.key === key);
}
