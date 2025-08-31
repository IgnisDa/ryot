export function getQueryEngineField<T extends { kind: string; value: unknown }>(
	item: Readonly<Record<string, T>> | undefined,
	key: string,
): (T & { key: string }) | undefined {
	if (!item) {
		return undefined;
	}

	if (!Object.prototype.hasOwnProperty.call(item, key)) {
		return undefined;
	}

	const field = item[key];
	return field ? { key, ...field } : undefined;
}
