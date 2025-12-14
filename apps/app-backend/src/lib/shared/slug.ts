import { badRequest } from "@ryot/contract/errors";
import { Slug } from "@ryot/contract/schema/brands";
import { Effect, Schema } from "effect";

export const slugify = (value: string) =>
	value
		.replaceAll("_", "-")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");

export const deriveSlug = (name: string | null | undefined, explicitSlug?: string) => {
	const candidate = explicitSlug?.trim() ?? name;
	return candidate ? slugify(candidate) : null;
};

export const requireSlug = (input: { label: string; name: string; slug?: string | undefined }) => {
	const slug = deriveSlug(input.name, input.slug);
	if (!slug) {
		return badRequest(`${input.label} slug is required`);
	}
	return Schema.decode(Slug)(slug).pipe(
		Effect.mapError(() => badRequest(`${input.label} slug is invalid`)),
	);
};
