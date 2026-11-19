import { Schema } from "effect";

import { EnrichmentState } from "../entities/schemas";

export const entityBrowserFields = {
	id: "__entityBrowserId",
	name: "__entityBrowserName",
	schema: "__entityBrowserSchemaSlug",
	owner: "__entityBrowserOwnerPluginId",
	population: "__entityBrowserPopulationStatus",
	translation: "__entityBrowserTranslationStatus",
} as const;

export const EntityBrowserRowFields = Schema.Struct({
	[entityBrowserFields.id]: Schema.String,
	[entityBrowserFields.name]: Schema.String,
	[entityBrowserFields.schema]: Schema.String,
	[entityBrowserFields.population]: EnrichmentState,
	[entityBrowserFields.translation]: EnrichmentState,
	[entityBrowserFields.owner]: Schema.NullOr(Schema.String),
});
