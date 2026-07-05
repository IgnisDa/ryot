import { builtinEntitySchemas } from "./entity-schemas";

export const builtinMediaEntitySchemaSlugs = builtinEntitySchemas()
	.filter(
		({ eventSchemas, pluginSlug }) =>
			pluginSlug === "media" && eventSchemas.some(({ slug }) => slug === "complete"),
	)
	.map(({ slug }) => slug);

export type BuiltinMediaEntitySchemaSlug = (typeof builtinMediaEntitySchemaSlugs)[number];
