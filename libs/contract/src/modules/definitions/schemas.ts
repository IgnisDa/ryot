import { Schema } from "effect";

import {
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginSlug,
	RelationshipSchemaSlug,
	SandboxProviderId,
} from "../../schema/brands";
import { AppSchema } from "../../schema/property-schema";

export const EventDefinition = Schema.Struct({
	name: Schema.String,
	slug: EventSchemaSlug,
	propertiesSchema: AppSchema,
});

export const EntityDefinition = Schema.Struct({
	name: Schema.String,
	icon: Schema.String,
	slug: EntitySchemaSlug,
	accentColor: Schema.String,
	propertiesSchema: AppSchema,
	eventSchemas: Schema.Array(EventDefinition),
	pluginSlug: Schema.optional(Schema.NullOr(PluginSlug)),
	providers: Schema.Array(Schema.Struct({ name: Schema.String, providerId: SandboxProviderId })),
});

export const RelationshipDefinition = Schema.Struct({
	name: Schema.String,
	slug: RelationshipSchemaSlug,
	propertiesSchema: AppSchema,
	sourceEntitySchemaSlug: Schema.NullOr(EntitySchemaSlug),
	targetEntitySchemaSlug: Schema.NullOr(EntitySchemaSlug),
});

export const ListedWorkspace = Schema.Struct({
	slug: PluginSlug,
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
	config: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

export type UpdateWorkspaceStateBody = typeof UpdateWorkspaceStateBody.Type;
