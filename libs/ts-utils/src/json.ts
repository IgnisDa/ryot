/**
 * Deterministic JSON serialization: object keys are always sorted so that
 * semantically-equal values produce byte-identical strings (useful for hashing
 * and equality checks). Pass `sortArrays` to also sort array elements, making
 * the result insensitive to array ordering (useful for set-equality checks).
 */
export const stableStringify = (value: unknown, options?: { sortArrays?: boolean }): string => {
	if (value === undefined) {
		return "null";
	}
	if (Array.isArray(value)) {
		const items = value.map((item) => stableStringify(item, options));
		return `[${(options?.sortArrays === true ? items.sort() : items).join(",")}]`;
	}
	if (value !== null && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(Reflect.get(value, key), options)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
};
