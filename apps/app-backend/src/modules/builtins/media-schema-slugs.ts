import { builtinEntitySchemas } from "./entity-schemas";

export const builtinMediaEntitySchemaSlugs = builtinEntitySchemas()
	.filter(
		({ eventSchemas, trackerSlug }) =>
			trackerSlug === "media" && eventSchemas.some(({ slug }) => slug === "complete"),
	)
	.map(({ slug }) => slug);

export type BuiltinMediaEntitySchemaSlug = (typeof builtinMediaEntitySchemaSlugs)[number];
