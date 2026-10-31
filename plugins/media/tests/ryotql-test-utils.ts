export const ryotqlDocumentNodes = (value: unknown): readonly unknown[] => {
	if (Array.isArray(value)) {
		return [value, ...value.flatMap(ryotqlDocumentNodes)];
	}
	if (typeof value === "object" && value !== null) {
		const nodes: unknown[] = [value];
		for (const [key, nested] of Object.entries(value)) {
			nodes.push(key, ...ryotqlDocumentNodes(nested));
		}
		return nodes;
	}
	return [value];
};
