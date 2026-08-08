export type ReorderPositions = Record<string, number>;

export function createReorderPositions(keys: readonly string[]) {
	"worklet";
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
	"worklet";
	if (props.fromIndex === props.toIndex) {
		return props.positions;
	}

	const next = { ...props.positions };
	for (const key of Object.keys(props.positions)) {
		const index = props.positions[key];
		if (index === undefined) {
			continue;
		}
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
		}
	}
	return next;
}
