import { DisplayConfiguration } from "@ryot/contract/display-configuration";
import { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import { AppSchema } from "@ryot/contract/schema/property-schema";
import { SANDBOX_HOST_CAPABILITIES } from "@ryot/sandbox-sdk/core";
import { Schema } from "effect";

const strictStruct = <Fields extends Record<string, Schema.Struct.Field>>(fields: Fields) =>
	Schema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "error" as const } });

export const PluginMetadata = strictStruct({
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	version: Schema.String,
	accentColor: Schema.String,
	description: Schema.String,
});

export type PluginMetadata = Schema.Schema.Type<typeof PluginMetadata>;

export const PluginEventSchema = strictStruct({
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: AppSchema,
});

export type PluginEventSchema = Schema.Schema.Type<typeof PluginEventSchema>;

export const PluginEntitySchema = strictStruct({
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	accentColor: Schema.String,
	propertiesSchema: AppSchema,
	eventSchemas: Schema.Array(PluginEventSchema),
});

export type PluginEntitySchema = Schema.Schema.Type<typeof PluginEntitySchema>;

export const PluginRelationshipSchema = strictStruct({
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: AppSchema,
	sourceEntitySchemaSlug: Schema.NullOr(Schema.String),
	targetEntitySchemaSlug: Schema.NullOr(Schema.String),
});

export type PluginRelationshipSchema = Schema.Schema.Type<typeof PluginRelationshipSchema>;

export const PluginSignalAudiencePolicy = Schema.Union(
	strictStruct({ kind: Schema.Literal("actor") }),
	strictStruct({
		kind: Schema.Literal("related_users"),
		relationshipSchemaSlug: Schema.String,
		subjectSide: Schema.Literal("source", "target"),
	}),
);

export type PluginSignalAudiencePolicy = Schema.Schema.Type<typeof PluginSignalAudiencePolicy>;

export const PluginSignalSchema = strictStruct({
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: AppSchema,
	audiencePolicy: PluginSignalAudiencePolicy,
	catalogState: Schema.Literal("active", "hidden"),
});

export type PluginSignalSchema = Schema.Schema.Type<typeof PluginSignalSchema>;

export const PluginSavedView = strictStruct({
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	sortOrder: Schema.Number,
	accentColor: Schema.String,
	queryDocument: QueryDocument,
	displayConfiguration: DisplayConfiguration,
	pluginSlug: Schema.NullOr(Schema.String),
});

export type PluginSavedView = Schema.Schema.Type<typeof PluginSavedView>;

const sandboxManifestString = Schema.String.pipe(
	Schema.filter((value) => value.length > 0 && value === value.trim(), {
		message: () => "Expected a non-empty string without surrounding whitespace",
	}),
);

const sandboxManifestSlug = Schema.String.pipe(
	Schema.filter((value) => /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value), {
		message: () => "Expected a sandbox manifest slug",
	}),
);

const PluginScriptFields = {
	name: sandboxManifestString,
	slug: sandboxManifestSlug,
	entry: Schema.String,
	requiredAppConfigKeys: Schema.Array(sandboxManifestString),
	capabilities: Schema.Array(Schema.Literal(...SANDBOX_HOST_CAPABILITIES)),
};

export const PluginScript = Schema.Union(
	strictStruct({ ...PluginScriptFields, kind: Schema.Literal("automation") }),
	strictStruct({
		...PluginScriptFields,
		kind: Schema.Literal("provider"),
		providerInformation: strictStruct({
			source: sandboxManifestString,
			canonicalLanguage: Schema.optional(sandboxManifestString),
		}),
	}),
);

export type PluginScript = Schema.Schema.Type<typeof PluginScript>;

export const PluginSchemaScriptLink = strictStruct({
	scriptSlug: Schema.String,
	entitySchemaSlug: Schema.String,
});

export type PluginSchemaScriptLink = Schema.Schema.Type<typeof PluginSchemaScriptLink>;

export const PluginLifecycleOperation = Schema.Literal("create", "delete", "update");

export type PluginLifecycleOperation = Schema.Schema.Type<typeof PluginLifecycleOperation>;

export const PluginEntityAutomation = strictStruct({
	scriptSlug: Schema.String,
	entitySchemaSlug: Schema.String,
	operation: PluginLifecycleOperation,
});

export type PluginEntityAutomation = Schema.Schema.Type<typeof PluginEntityAutomation>;

export const PluginRelationshipAutomation = strictStruct({
	scriptSlug: Schema.String,
	operation: PluginLifecycleOperation,
	relationshipSchemaSlug: Schema.String,
});

export type PluginRelationshipAutomation = Schema.Schema.Type<typeof PluginRelationshipAutomation>;

export const PluginEventAutomation = strictStruct({
	scriptSlug: Schema.String,
	eventSchemaSlug: Schema.String,
	position: Schema.optional(Schema.Number),
	kind: Schema.Literal("policy", "subscription"),
	metadata: Schema.optional(
		strictStruct({ inheritedProperties: Schema.optional(Schema.Array(Schema.String)) }),
	),
});

export type PluginEventAutomation = Schema.Schema.Type<typeof PluginEventAutomation>;

export const PluginSignalAutomation = strictStruct({
	scriptSlug: Schema.String,
	signalSchemaSlug: Schema.String,
});

export type PluginSignalAutomation = Schema.Schema.Type<typeof PluginSignalAutomation>;

export const PluginBindings = strictStruct({
	eventAutomations: Schema.Array(PluginEventAutomation),
	entityAutomations: Schema.Array(PluginEntityAutomation),
	signalAutomations: Schema.Array(PluginSignalAutomation),
	schemaScriptLinks: Schema.Array(PluginSchemaScriptLink),
	relationshipAutomations: Schema.Array(PluginRelationshipAutomation),
});

export type PluginBindings = Schema.Schema.Type<typeof PluginBindings>;

export const PluginManifest = strictStruct({
	metadata: PluginMetadata,
	bindings: PluginBindings,
	scripts: Schema.Array(PluginScript),
	savedViews: Schema.Array(PluginSavedView),
	entitySchemas: Schema.Array(PluginEntitySchema),
	signalSchemas: Schema.Array(PluginSignalSchema),
	relationshipSchemas: Schema.Array(PluginRelationshipSchema),
});

export type PluginManifest = Schema.Schema.Type<typeof PluginManifest>;

export const definePlugin = <const Manifest extends PluginManifest>(
	manifest: Manifest & Record<Exclude<keyof Manifest, keyof PluginManifest>, never>,
) => manifest;
