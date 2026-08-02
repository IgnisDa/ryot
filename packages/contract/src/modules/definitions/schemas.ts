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

const EventDefinition = Schema.Struct({
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
	propertiesSchema: AppSchema,
	slug: RelationshipSchemaSlug,
	sourceEntitySchemaSlug: Schema.NullOr(EntitySchemaSlug),
	targetEntitySchemaSlug: Schema.NullOr(EntitySchemaSlug),
});
