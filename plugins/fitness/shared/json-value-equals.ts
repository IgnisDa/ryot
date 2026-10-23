export const jsonValueEquals = (left: unknown, right: unknown): boolean => {
	if (left === right) {
		return true;
	}
	if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
		return false;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => jsonValueEquals(value, right[index]))
		);
	}
	const leftEntries = Object.entries(left);
	const rightEntries = Object.entries(right);
	return (
		leftEntries.length === rightEntries.length &&
		leftEntries.every(
			([key, value]) =>
				Object.hasOwn(right, key) && jsonValueEquals(value, Reflect.get(right, key)),
		)
	);
};
