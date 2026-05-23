import { Schema } from "effect";

import {
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginSlug,
	RelationshipSchemaSlug,
	SandboxProviderId,
} from "../../schema/brands";
import { AppSchema } from "../../schema/property-schema";
import { PluginInstallationItem } from "../plugins/schemas";

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
	slug: RelationshipSchemaSlug,
	propertiesSchema: AppSchema,
	sourceEntitySchemaSlug: Schema.NullOr(EntitySchemaSlug),
	targetEntitySchemaSlug: Schema.NullOr(EntitySchemaSlug),
});

export const ListedPlugin = Schema.Struct({
	slug: PluginInstallationItem.fields.slug,
	name: PluginInstallationItem.fields.name,
	icon: PluginInstallationItem.fields.icon,
	version: PluginInstallationItem.fields.version,
	sortOrder: PluginInstallationItem.fields.sortOrder,
	isDisabled: PluginInstallationItem.fields.isDisabled,
	description: PluginInstallationItem.fields.description,
});

export type ListedPlugin = typeof ListedPlugin.Type;
