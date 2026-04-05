import { entitySchemaScriptLinks } from "~/lib/db/seed/manifests";

export const builtinMediaEntitySchemaSlugs = Array.from(
	new Set(entitySchemaScriptLinks().map((link) => link.schemaSlug)),
);

export const builtinMediaEntitySchemaSlugSet: ReadonlySet<string> = new Set(
	builtinMediaEntitySchemaSlugs,
);
