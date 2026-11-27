export const isExternalReference = (reference: string) =>
	reference.startsWith("#") ||
	reference.startsWith("data:") ||
	reference.startsWith("//") ||
	/^[a-z][\w+.-]*:/i.test(reference);

export const referencePath = (reference: string) => reference.split(/[?#]/, 1)[0] ?? "";
