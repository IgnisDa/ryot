export function applyReorderPatch<T extends { id: string; sortOrder: number }>(
	items: T[],
	ids: string[],
): T[] {
	const itemMap = new Map(items.map((item) => [item.id, item]));
	const reordered: T[] = [];
	const seen = new Set<string>();

	for (const id of ids) {
		const item = itemMap.get(id);
		if (item) {
			reordered.push(item);
			seen.add(id);
		}
	}

	for (const item of items) {
		if (!seen.has(item.id)) {
			reordered.push(item);
		}
	}

	return reordered.map((item, index) => Object.assign(item, { sortOrder: index + 1 }));
}
