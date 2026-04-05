import { Schema } from "effect";

import { SandboxProviderId } from "../../schema/brands";
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
	providers: Schema.Array(Schema.Struct({ name: Schema.String, providerId: SandboxProviderId })),
	pluginSlug: Schema.optional(Schema.NullOr(Schema.String)),
});

export const RelationshipDefinition = Schema.Struct({
	slug: Schema.String,
	name: Schema.String,
	propertiesSchema: AppSchema,
	sourceEntitySchemaSlug: Schema.NullOr(Schema.String),
	targetEntitySchemaSlug: Schema.NullOr(Schema.String),
});

export const ListedWorkspace = Schema.Struct({
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	config: Schema.Unknown,
	version: Schema.String,
	sortOrder: Schema.Number,
	isDisabled: Schema.Boolean,
	accentColor: Schema.String,
	description: Schema.String,
});

export type ListedWorkspace = typeof ListedWorkspace.Type;

export const UpdateWorkspaceStateBody = Schema.Struct({
	sortOrder: Schema.optional(Schema.Number),
	isDisabled: Schema.optional(Schema.Boolean),
	config: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

export type UpdateWorkspaceStateBody = typeof UpdateWorkspaceStateBody.Type;
