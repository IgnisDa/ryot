import { Schema } from "effect";

import {
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginSlug,
	RelationshipSchemaSlug,
	SandboxProviderId,
} from "../../schema/brands";
import { AppSchema } from "../../schema/property-schema";

export { UpdatePluginInstallationBody as UpdatePluginStateBody } from "../plugins/schemas";

const DefinitionNotFoundReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("plugin-not-found"), pluginSlug: PluginSlug }),
]);

export class DefinitionNotFound extends Schema.TaggedError<DefinitionNotFound>()(
	"DefinitionNotFound",
	{ reason: DefinitionNotFoundReason },
) {}

export const EventDefinition = Schema.Struct({
	name: Schema.String,
	slug: EventSchemaSlug,
	propertiesSchema: AppSchema,
});

export const EntityDefinition = Schema.Struct({
	name: Schema.String,
	icon: Schema.String,
	slug: EntitySchemaSlug,
	propertiesSchema: AppSchema,
	eventSchemas: Schema.Array(EventDefinition),
	pluginSlug: Schema.optional(Schema.NullOr(PluginSlug)),
	providers: Schema.Array(Schema.Struct({ name: Schema.String, providerId: SandboxProviderId })),
});

export type EntityDefinition = typeof EntityDefinition.Type;

export const RelationshipDefinition = Schema.Struct({
	name: Schema.String,
	slug: RelationshipSchemaSlug,
	propertiesSchema: AppSchema,
	sourceEntitySchemaSlug: Schema.NullOr(EntitySchemaSlug),
	targetEntitySchemaSlug: Schema.NullOr(EntitySchemaSlug),
});

export const ListedPlugin = Schema.Struct({
	slug: PluginSlug,
	name: Schema.String,
	icon: Schema.String,
	version: Schema.String,
	sortOrder: Schema.Number,
	isDisabled: Schema.Boolean,
	description: Schema.String,
});

export type ListedPlugin = typeof ListedPlugin.Type;
