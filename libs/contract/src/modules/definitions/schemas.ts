import { Schema } from "effect";

import { AppSchema } from "../../schema/property-schema";

export const EventDefinition = Schema.Struct({
	slug: Schema.String,
	name: Schema.String,
	propertiesSchema: AppSchema,
});

export const EntityDefinition = Schema.Struct({
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	accentColor: Schema.String,
	propertiesSchema: AppSchema,
	eventSchemas: Schema.Array(EventDefinition),
});

export const RelationshipDefinition = Schema.Struct({
	slug: Schema.String,
	name: Schema.String,
	propertiesSchema: AppSchema,
	sourceEntitySchemaSlug: Schema.NullOr(Schema.String),
	targetEntitySchemaSlug: Schema.NullOr(Schema.String),
});

export const TrackerDefinition = Schema.Struct({
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	sortOrder: Schema.Number,
	accentColor: Schema.String,
	description: Schema.NullOr(Schema.String),
	entitySchemaSlugs: Schema.Array(Schema.String),
});
