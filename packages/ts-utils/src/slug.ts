import slugify from "slugify";

export const normalizeSlug = (value: string) => {
	return slugify(value.replaceAll("_", "-"), { trim: true, lower: true, strict: true });
};
