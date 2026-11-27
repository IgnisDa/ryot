export const slugify = (value: string) =>
	value
		.replaceAll("_", "-")
		.trim()
		.toLowerCase()
		.replaceAll(/\s+/g, "-")
		.replaceAll(/[^a-z0-9-]/g, "")
		.replaceAll(/-+/g, "-")
		.replaceAll(/^-+|-+$/g, "");
