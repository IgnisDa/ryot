import type { Effect } from "@ryot/sandbox-sdk/effect";
import { Schema } from "@ryot/sandbox-sdk/effect";

import {
	hostResultSchema,
	jsonValueSchema,
	type JsonValue,
	type SandboxHostError,
} from "./wire.js";

export {
	defineDriver,
	defineManifest,
	defineScript,
	SANDBOX_SCRIPT_DEFINITION,
	type GenericDriver,
	type GenericScriptDefinition,
} from "./driver.js";

export {
	hostFailureSchema,
	hostResultSchema,
	jsonValueSchema,
	sandboxHostErrorSchema,
	type HostFailure,
	type HostResult,
	type JsonPrimitive,
	type JsonValue,
	type SandboxHostError,
} from "./wire.js";

const strictStruct = <Fields extends Record<string, Schema.Struct.Field>>(fields: Fields) =>
	Schema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "error" as const } });

const nonEmptyString = Schema.String.pipe(Schema.minLength(1));
const positiveInteger = Schema.Number.pipe(Schema.int(), Schema.positive());

export interface SandboxAppConfigRegistry {}

type RegisteredSandboxAppConfig = SandboxAppConfigRegistry[keyof SandboxAppConfigRegistry];
type SandboxAppConfigKey = [RegisteredSandboxAppConfig] extends [never]
	? string
	: keyof RegisteredSandboxAppConfig & string;
type SandboxAppConfigValue<Key extends SandboxAppConfigKey> = [RegisteredSandboxAppConfig] extends [
	never,
]
	? JsonValue
	: RegisteredSandboxAppConfig[Key & keyof RegisteredSandboxAppConfig];
type GetAppConfigValue = <Key extends SandboxAppConfigKey>(
	key: Key,
) => Effect.Effect<SandboxAppConfigValue<Key>, SandboxHostError>;

export const CORE_SANDBOX_HOST_CAPABILITIES = [
	"httpCall",
	"getCachedValue",
	"setCachedValue",
	"claimCachedValue",
	"getAppConfigValue",
	"getUserPreferences",
] as const;

export const coreSandboxHostCapabilitySchema = Schema.Literal(...CORE_SANDBOX_HOST_CAPABILITIES);
export type CoreSandboxHostCapability = Schema.Schema.Type<typeof coreSandboxHostCapabilitySchema>;

const cacheKeySchema = nonEmptyString;
const cacheTtlSecondsSchema = positiveInteger;
export const httpCallOptionsSchema = strictStruct({
	body: Schema.optional(Schema.String),
	headers: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
});
export const httpCallResponseSchema = strictStruct({
	body: Schema.String,
	status: Schema.Number.pipe(Schema.int()),
	headers: Schema.Record({ key: Schema.String, value: Schema.String }),
});
export const httpCallFailureDetailsSchema = strictStruct({
	status: Schema.Number.pipe(Schema.int()),
});
export const httpCallArgsSchema = Schema.Tuple(
	Schema.String,
	Schema.String,
	Schema.optionalElement(httpCallOptionsSchema),
);
export const httpCallResultSchema = Schema.Union(
	strictStruct({
		error: Schema.String,
		success: Schema.Literal(false),
		data: Schema.optional(httpCallFailureDetailsSchema),
	}),
	strictStruct({ data: httpCallResponseSchema, success: Schema.Literal(true) }),
);
export const getCachedValueArgsSchema = Schema.Tuple(cacheKeySchema);
export const getCachedValueDataSchema = Schema.NullOr(jsonValueSchema);
export const getCachedValueResultSchema = hostResultSchema(getCachedValueDataSchema);
export const setCachedValueArgsSchema = Schema.Tuple(
	cacheKeySchema,
	jsonValueSchema,
	cacheTtlSecondsSchema,
);
export const setCachedValueDataSchema = Schema.Null;
export const setCachedValueResultSchema = hostResultSchema(setCachedValueDataSchema);
export const cacheClaimSchema = Schema.Union(
	strictStruct({ claimed: Schema.Literal(true) }),
	strictStruct({ claimed: Schema.Literal(false), value: Schema.NullOr(jsonValueSchema) }),
);
export const claimCachedValueArgsSchema = Schema.Tuple(
	cacheKeySchema,
	jsonValueSchema,
	cacheTtlSecondsSchema,
);
export const claimCachedValueResultSchema = hostResultSchema(cacheClaimSchema);
export const getAppConfigValueArgsSchema = Schema.Tuple(nonEmptyString);
export const getAppConfigValueResultSchema = hostResultSchema(jsonValueSchema);
export const userPreferencesSchema = strictStruct({
	isNsfw: Schema.Boolean,
	disableIntegrations: Schema.Boolean,
});
export const getUserPreferencesArgsSchema = Schema.Tuple();
export const getUserPreferencesResultSchema = hostResultSchema(userPreferencesSchema);

export const coreSandboxHostContracts = {
	httpCall: {
		args: httpCallArgsSchema,
		result: httpCallResultSchema,
		success: httpCallResponseSchema,
	},
	getCachedValue: {
		args: getCachedValueArgsSchema,
		result: getCachedValueResultSchema,
		success: getCachedValueDataSchema,
	},
	setCachedValue: {
		args: setCachedValueArgsSchema,
		result: setCachedValueResultSchema,
		success: setCachedValueDataSchema,
	},
	claimCachedValue: {
		success: cacheClaimSchema,
		args: claimCachedValueArgsSchema,
		result: claimCachedValueResultSchema,
	},
	getAppConfigValue: {
		success: jsonValueSchema,
		args: getAppConfigValueArgsSchema,
		result: getAppConfigValueResultSchema,
	},
	getUserPreferences: {
		success: userPreferencesSchema,
		args: getUserPreferencesArgsSchema,
		result: getUserPreferencesResultSchema,
	},
} as const;

type SandboxHostContract = {
	readonly args: Schema.Schema.AnyNoContext;
	readonly success: Schema.Schema.AnyNoContext;
};
type SandboxHostMethodMapFromContracts<Contracts extends Record<string, SandboxHostContract>> = {
	readonly [Capability in keyof Contracts]: (
		...args: Schema.Schema.Type<Contracts[Capability]["args"]> extends readonly unknown[]
			? Schema.Schema.Type<Contracts[Capability]["args"]>
			: never
	) => Effect.Effect<Schema.Schema.Type<Contracts[Capability]["success"]>, SandboxHostError>;
};

export type CoreSandboxHostMethodMap = SandboxHostMethodMapFromContracts<
	typeof coreSandboxHostContracts
>;
export type CoreSandboxHostImplementationMap<Context> = {
	readonly [Capability in CoreSandboxHostCapability]: (
		context: Context,
		...args: Parameters<CoreSandboxHostMethodMap[Capability]>
	) => ReturnType<CoreSandboxHostMethodMap[Capability]>;
};

export const DOMAIN_SANDBOX_HOST_CAPABILITIES = [
	"getEntity",
	"listEvents",
	"createEvents",
	"getIntegration",
	"getEntitySchema",
	"listEventSchemas",
	"listIntegrations",
	"executeQueryEngine",
] as const;
export const domainSandboxHostCapabilitySchema = Schema.Literal(
	...DOMAIN_SANDBOX_HOST_CAPABILITIES,
);
export type DomainSandboxHostCapability = Schema.Schema.Type<
	typeof domainSandboxHostCapabilitySchema
>;

const sandboxIdSchema = nonEmptyString;
export const integrationLotSchema = Schema.Literal("push", "sink", "yank");
export const integrationProviderSchema = Schema.Literal(
	"emby",
	"kodi",
	"komga",
	"radarr",
	"sonarr",
	"plex_sink",
	"plex_yank",
	"generic_json",
	"youtube_music",
	"jellyfin_push",
	"jellyfin_sink",
	"audiobookshelf",
	"ryot_browser_extension",
);
export const entityRecordSchema = strictStruct({
	id: Schema.String,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: jsonValueSchema,
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(Schema.String),
	entitySchemaSlug: Schema.String,
	sandboxScriptId: Schema.NullOr(Schema.String),
});
export type EntityRecord = Schema.Schema.Type<typeof entityRecordSchema>;

export const entitySchemaProviderSchema = strictStruct({
	name: Schema.String,
	scriptId: Schema.String,
});
export const entitySchemaRecordSchema = strictStruct({
	id: Schema.String,
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	isBuiltin: Schema.Boolean,
	pluginSlug: Schema.String,
	accentColor: Schema.String,
	propertiesSchema: jsonValueSchema,
	providers: Schema.Array(entitySchemaProviderSchema),
});
export type EntitySchemaRecord = Schema.Schema.Type<typeof entitySchemaRecordSchema>;

export const eventSchemaRecordSchema = strictStruct({
	id: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	entitySchemaSlug: Schema.String,
	propertiesSchema: jsonValueSchema,
});
export type EventSchemaRecord = Schema.Schema.Type<typeof eventSchemaRecordSchema>;

export const eventRecordSchema = strictStruct({
	id: Schema.String,
	entityId: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	occurredAt: Schema.String,
	properties: jsonValueSchema,
	eventSchemaName: Schema.String,
	eventSchemaSlug: Schema.String,
	sessionEntityId: Schema.optional(Schema.String),
});
export type EventRecord = Schema.Schema.Type<typeof eventRecordSchema>;

export const integrationRecordSchema = strictStruct({
	id: Schema.String,
	userId: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	lot: integrationLotSchema,
	isDisabled: Schema.Boolean,
	syncOwnership: Schema.Boolean,
	minimumProgress: Schema.Number,
	maximumProgress: Schema.Number,
	providerSpecifics: jsonValueSchema,
	provider: integrationProviderSchema,
	name: Schema.NullOr(Schema.String),
	webhookUrl: Schema.optional(Schema.String),
	lastFinishedAt: Schema.NullOr(Schema.String),
	extraSettings: strictStruct({ disableOnContinuousErrors: Schema.Boolean }),
});
export type IntegrationRecord = Schema.Schema.Type<typeof integrationRecordSchema>;

export const createEventItemSchema = strictStruct({
	entityId: sandboxIdSchema,
	properties: jsonValueSchema,
	eventSchemaSlug: sandboxIdSchema,
	occurredAt: Schema.optional(Schema.String),
	sessionEntityId: Schema.optional(sandboxIdSchema),
});
export type CreateEventItem = Schema.Schema.Type<typeof createEventItemSchema>;
export const createEventsResultDataSchema = strictStruct({
	count: Schema.Number.pipe(Schema.int()),
});
export const listEventsQuerySchema = strictStruct({
	entityId: Schema.optional(sandboxIdSchema),
	eventSchemaSlug: Schema.optional(Schema.String),
	sessionEntityId: Schema.optional(sandboxIdSchema),
});
export type ListEventsQuery = Schema.Schema.Type<typeof listEventsQuerySchema>;
export const listIntegrationsOptionsSchema = strictStruct({
	isDisabled: Schema.optional(Schema.Boolean),
	provider: Schema.optional(integrationProviderSchema),
});
export type ListIntegrationsOptions = Schema.Schema.Type<typeof listIntegrationsOptionsSchema>;
export const queryDocumentSchema = jsonValueSchema;
export type QueryDocument = Schema.Schema.Type<typeof queryDocumentSchema>;

export const getEntityArgsSchema = Schema.Tuple(sandboxIdSchema);
export const getEntityResultSchema = hostResultSchema(entityRecordSchema);
export const getEntitySchemaArgsSchema = Schema.Tuple(sandboxIdSchema);
export const getEntitySchemaResultSchema = hostResultSchema(entitySchemaRecordSchema);
export const getIntegrationArgsSchema = Schema.Tuple(sandboxIdSchema);
export const getIntegrationResultSchema = hostResultSchema(integrationRecordSchema);
export const listEventSchemasArgsSchema = Schema.Tuple(sandboxIdSchema);
export const listEventSchemasDataSchema = Schema.Array(eventSchemaRecordSchema);
export const listEventSchemasResultSchema = hostResultSchema(listEventSchemasDataSchema);
export const listEventsArgsSchema = Schema.Tuple(Schema.optionalElement(listEventsQuerySchema));
export const listEventsDataSchema = Schema.Array(eventRecordSchema);
export const listEventsResultSchema = hostResultSchema(listEventsDataSchema);
export const listIntegrationsArgsSchema = Schema.Tuple(
	Schema.optionalElement(listIntegrationsOptionsSchema),
);
export const listIntegrationsDataSchema = Schema.Array(integrationRecordSchema);
export const listIntegrationsResultSchema = hostResultSchema(listIntegrationsDataSchema);
export const createEventsArgsSchema = Schema.Tuple(Schema.Array(createEventItemSchema));
export const createEventsResultSchema = hostResultSchema(createEventsResultDataSchema);
export const executeQueryEngineArgsSchema = Schema.Tuple(queryDocumentSchema);
export const executeQueryEngineDataSchema = Schema.Unknown;
export const executeQueryEngineResultSchema = hostResultSchema(executeQueryEngineDataSchema);

export const domainSandboxHostContracts = {
	getEntity: {
		args: getEntityArgsSchema,
		success: entityRecordSchema,
		result: getEntityResultSchema,
	},
	listEvents: {
		args: listEventsArgsSchema,
		success: listEventsDataSchema,
		result: listEventsResultSchema,
	},
	createEvents: {
		args: createEventsArgsSchema,
		result: createEventsResultSchema,
		success: createEventsResultDataSchema,
	},
	getIntegration: {
		args: getIntegrationArgsSchema,
		success: integrationRecordSchema,
		result: getIntegrationResultSchema,
	},
	getEntitySchema: {
		args: getEntitySchemaArgsSchema,
		success: entitySchemaRecordSchema,
		result: getEntitySchemaResultSchema,
	},
	listEventSchemas: {
		args: listEventSchemasArgsSchema,
		success: listEventSchemasDataSchema,
		result: listEventSchemasResultSchema,
	},
	listIntegrations: {
		args: listIntegrationsArgsSchema,
		success: listIntegrationsDataSchema,
		result: listIntegrationsResultSchema,
	},
	executeQueryEngine: {
		args: executeQueryEngineArgsSchema,
		success: executeQueryEngineDataSchema,
		result: executeQueryEngineResultSchema,
	},
} as const;

export type DomainSandboxHostMethodMap = SandboxHostMethodMapFromContracts<
	typeof domainSandboxHostContracts
>;
export type DomainSandboxHostImplementationMap<Context> = {
	readonly [Capability in DomainSandboxHostCapability]: (
		context: Context,
		...args: Parameters<DomainSandboxHostMethodMap[Capability]>
	) => ReturnType<DomainSandboxHostMethodMap[Capability]>;
};

export const AUTOMATION_SANDBOX_HOST_CAPABILITIES = ["emitSignal", "sendNotification"] as const;
export type AutomationSandboxHostCapability = (typeof AUTOMATION_SANDBOX_HOST_CAPABILITIES)[number];
export const emitSignalRequestSchema = strictStruct({
	schemaSlug: nonEmptyString,
	discriminator: nonEmptyString,
	subjectEntityId: Schema.optional(sandboxIdSchema),
	properties: Schema.Record({ key: Schema.String, value: jsonValueSchema }),
});
export const emitSignalArgsSchema = Schema.Tuple(emitSignalRequestSchema);
export const emitSignalDataSchema = strictStruct({
	signalId: Schema.String,
	wasCreated: Schema.Boolean,
});
export const emitSignalResultSchema = hostResultSchema(emitSignalDataSchema);
export const sendNotificationArgsSchema = Schema.Tuple(Schema.Trim.pipe(Schema.minLength(1)));
export const automationSandboxHostContracts = {
	emitSignal: {
		args: emitSignalArgsSchema,
		success: emitSignalDataSchema,
		result: emitSignalResultSchema,
	},
	sendNotification: {
		success: Schema.Null,
		args: sendNotificationArgsSchema,
		result: hostResultSchema(Schema.Null),
	},
} as const;
export type AutomationSandboxHostMethodMap = SandboxHostMethodMapFromContracts<
	typeof automationSandboxHostContracts
>;
export type AutomationSandboxHostImplementationMap<Context> = {
	readonly [Capability in AutomationSandboxHostCapability]: (
		context: Context,
		...args: Parameters<AutomationSandboxHostMethodMap[Capability]>
	) => ReturnType<AutomationSandboxHostMethodMap[Capability]>;
};

export const SANDBOX_HOST_CAPABILITIES = [
	...CORE_SANDBOX_HOST_CAPABILITIES,
	...DOMAIN_SANDBOX_HOST_CAPABILITIES,
	...AUTOMATION_SANDBOX_HOST_CAPABILITIES,
] as const;
export const sandboxHostCapabilitySchema = Schema.Literal(...SANDBOX_HOST_CAPABILITIES);
export type SandboxHostCapability = Schema.Schema.Type<typeof sandboxHostCapabilitySchema>;
export type SandboxHostMethodMap = Omit<CoreSandboxHostMethodMap, "getAppConfigValue"> &
	DomainSandboxHostMethodMap &
	AutomationSandboxHostMethodMap & { readonly getAppConfigValue: GetAppConfigValue };
export type SandboxHostImplementationMap<Context> = CoreSandboxHostImplementationMap<Context> &
	DomainSandboxHostImplementationMap<Context> &
	AutomationSandboxHostImplementationMap<Context>;

const manifestStringSchema = Schema.String.pipe(
	Schema.filter((value) => value.length > 0 && value === value.trim(), {
		message: () => "Must not be empty or have leading or trailing whitespace",
	}),
);
const manifestSlugSchema = Schema.String.pipe(
	Schema.filter((value) => /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)),
);
export const providerInformationSchema = strictStruct({
	source: manifestStringSchema,
	canonicalLanguage: Schema.optional(manifestStringSchema),
});
const sandboxManifestBaseFields = {
	name: manifestStringSchema,
	slug: manifestSlugSchema,
	capabilities: Schema.Array(sandboxHostCapabilitySchema),
	requiredAppConfigKeys: Schema.Array(manifestStringSchema),
};
export const sandboxManifestSchema = Schema.Union(
	strictStruct({ ...sandboxManifestBaseFields, kind: Schema.Literal("script") }),
	strictStruct({ ...sandboxManifestBaseFields, kind: Schema.Literal("automation") }),
	strictStruct({
		...sandboxManifestBaseFields,
		kind: Schema.Literal("provider"),
		providerInformation: providerInformationSchema,
	}),
);
export type SandboxManifest = Schema.Schema.Type<typeof sandboxManifestSchema>;
export type ScriptManifest = Extract<SandboxManifest, { readonly kind: "script" }>;
export type ProviderInformation = Schema.Schema.Type<typeof providerInformationSchema>;

export const executionMetadataSchema = strictStruct({
	metadata: jsonValueSchema,
	sandboxScriptId: nonEmptyString,
});
export type ExecutionMetadata = Schema.Schema.Type<typeof executionMetadataSchema>;
export type SandboxHost<Capabilities extends readonly SandboxHostCapability[]> = Readonly<
	Pick<SandboxHostMethodMap, Capabilities[number]>
>;
