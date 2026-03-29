import { entitySchemaScriptLinks } from "~/lib/db/seed/manifests";

const builtinMediaEntitySchemaSlugValues = entitySchemaScriptLinks().map(
	(link) => link.schemaSlug,
);

export type BuiltinMediaEntitySchemaSlug =
	(typeof builtinMediaEntitySchemaSlugValues)[number];

export const builtinMediaEventSchemaSlugs = [
	"review",
	"backlog",
	"progress",
	"complete",
] as const;

export type BuiltinMediaEventSchemaSlug =
	(typeof builtinMediaEventSchemaSlugs)[number];

export const builtinMediaEntitySchemaSlugs = Array.from(
	new Set(builtinMediaEntitySchemaSlugValues),
) as BuiltinMediaEntitySchemaSlug[];

export const builtinMediaEntitySchemaSlugSet: ReadonlySet<BuiltinMediaEntitySchemaSlug> =
	new Set(builtinMediaEntitySchemaSlugs);
