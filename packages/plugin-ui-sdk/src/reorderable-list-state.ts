export type ReorderPositions = Record<string, number>;

export function createReorderPositions(keys: readonly string[]) {
	const positions: ReorderPositions = {};
	for (const [index, key] of keys.entries()) {
		positions[key] = index;
	}
	return positions;
}

export function moveReorderPosition(props: {
	toIndex: number;
	fromIndex: number;
	positions: ReorderPositions;
}) {
	if (props.fromIndex === props.toIndex) {
		return props.positions;
	}

	const next: ReorderPositions = {};
	for (const [key, index] of Object.entries(props.positions)) {
		if (index === props.fromIndex) {
			next[key] = props.toIndex;
		} else if (
			props.fromIndex < props.toIndex &&
			index > props.fromIndex &&
			index <= props.toIndex
		) {
			next[key] = index - 1;
		} else if (
			props.fromIndex > props.toIndex &&
			index >= props.toIndex &&
			index < props.fromIndex
		) {
			next[key] = index + 1;
		} else {
			next[key] = index;
		}
	}
	return next;
}
