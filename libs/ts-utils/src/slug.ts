import slugify from "slugify";

export const normalizeSlug = (value: string) => {
	return slugify(value.replaceAll("_", "-"), {
		trim: true,
		lower: true,
		strict: true,
	});
};

export const resolveRequiredSlug = (input: {
	name: string;
	label: string;
	slug?: string;
}) => {
	const candidate = input.slug ?? input.name;
	const resolvedSlug = normalizeSlug(candidate);

	if (!resolvedSlug) {
		throw new Error(`${input.label} slug is required`);
	}

	return resolvedSlug;
};

export const resolveRequiredString = (input: string, label: string): string => {
	const resolved = input.trim();
	if (!resolved) {
		throw new Error(`${label} is required`);
	}
	return resolved;
};
