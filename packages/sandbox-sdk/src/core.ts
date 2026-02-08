import type { Effect } from "@ryot/sandbox-sdk/effect";
import { Schema } from "@ryot/sandbox-sdk/effect";

import { hostResultSchema, jsonValueSchema, type JsonValue, type SandboxHostError } from "./wire";

const strictStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	Schema.Struct(fields).annotate({ parseOptions: { onExcessProperty: "error" as const } });

const nonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const positiveInteger = Schema.Number.pipe(
	Schema.check(Schema.isInt()),
	Schema.check(Schema.isGreaterThan(0)),
);

type GetConfigValue = <Value extends JsonValue = JsonValue>(
	key: string,
) => Effect.Effect<Value, SandboxHostError>;

export const CORE_SANDBOX_HOST_CAPABILITIES = [
	"log",
	"span",
	"httpCall",
	"getCachedValue",
	"setCachedValue",
	"claimCachedValue",
	"getPluginConfigValue",
	"getSystemConfigValue",
	"getUserPreferences",
] as const;

export const coreSandboxHostCapabilitySchema = Schema.Literals([...CORE_SANDBOX_HOST_CAPABILITIES]);
export type CoreSandboxHostCapability = Schema.Schema.Type<typeof coreSandboxHostCapabilitySchema>;

const cacheKeySchema = nonEmptyString;
const cacheTtlSecondsSchema = positiveInteger;
export const httpCallOptionsSchema = strictStruct({
	body: Schema.optional(Schema.String),
	allowInsecureConnections: Schema.optional(Schema.Boolean),
	headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export const httpCallResponseSchema = strictStruct({
	body: Schema.String,
	status: Schema.Number.pipe(Schema.check(Schema.isInt())),
	headers: Schema.Record(Schema.String, Schema.String),
});
export const httpCallFailureDetailsSchema = strictStruct({
	status: Schema.Number.pipe(Schema.check(Schema.isInt())),
});
export const httpCallArgsSchema = Schema.Tuple([
	Schema.String,
	Schema.String,
	Schema.optionalKey(httpCallOptionsSchema),
]);
export const httpCallResultSchema = Schema.Union([
	strictStruct({
		error: Schema.String,
		success: Schema.Literal(false),
		data: Schema.optional(httpCallFailureDetailsSchema),
	}),
	strictStruct({ data: httpCallResponseSchema, success: Schema.Literal(true) }),
]);
export const getCachedValueArgsSchema = Schema.Tuple([cacheKeySchema]);
export const getCachedValueDataSchema = Schema.NullOr(jsonValueSchema);
export const getCachedValueResultSchema = hostResultSchema(getCachedValueDataSchema);
export const setCachedValueArgsSchema = Schema.Tuple([
	cacheKeySchema,
	jsonValueSchema,
	cacheTtlSecondsSchema,
]);
export const setCachedValueDataSchema = Schema.Null;
export const setCachedValueResultSchema = hostResultSchema(setCachedValueDataSchema);
export const cacheClaimSchema = Schema.Union([
	strictStruct({ claimed: Schema.Literal(true) }),
	strictStruct({ claimed: Schema.Literal(false), value: Schema.NullOr(jsonValueSchema) }),
]);
export const claimCachedValueArgsSchema = Schema.Tuple([
	cacheKeySchema,
	jsonValueSchema,
	cacheTtlSecondsSchema,
]);
export const getPluginConfigValueArgsSchema = Schema.Tuple([nonEmptyString]);
export const getSystemConfigValueArgsSchema = Schema.Tuple([nonEmptyString]);
export const claimCachedValueResultSchema = hostResultSchema(cacheClaimSchema);
export const getPluginConfigValueResultSchema = hostResultSchema(jsonValueSchema);
export const getSystemConfigValueResultSchema = hostResultSchema(jsonValueSchema);
export const userPreferencesSchema = strictStruct({
	isNsfw: Schema.Boolean,
	disableIntegrations: Schema.Boolean,
});
export const getUserPreferencesArgsSchema = Schema.Tuple([]);
export const getUserPreferencesResultSchema = hostResultSchema(userPreferencesSchema);
export const logEntrySchema = strictStruct({
	message: nonEmptyString,
	level: Schema.Literals(["debug", "info", "warning", "error"]),
	attributes: Schema.optional(Schema.Record(Schema.String, jsonValueSchema)),
});
export type LogEntry = Schema.Schema.Type<typeof logEntrySchema>;
export const logEntriesSchema = Schema.Array(logEntrySchema);
export const logArgsSchema = Schema.Tuple([logEntriesSchema]);
export const logResultSchema = hostResultSchema(Schema.Null);
export const spanEntrySchema = strictStruct({
	name: nonEmptyString,
	attributes: Schema.optional(Schema.Record(Schema.String, jsonValueSchema)),
});
export type SpanEntry = Schema.Schema.Type<typeof spanEntrySchema>;
export const spanResultSchema = hostResultSchema(Schema.Null);
export const spanEntriesSchema = Schema.Array(spanEntrySchema);
export const spanArgsSchema = Schema.Tuple([spanEntriesSchema]);

export const coreSandboxHostContracts = {
	log: { args: logArgsSchema, success: Schema.Null, result: logResultSchema },
	span: { success: Schema.Null, args: spanArgsSchema, result: spanResultSchema },
	httpCall: {
		args: httpCallArgsSchema,
		result: httpCallResultSchema,
		success: httpCallResponseSchema,
	},
	getCachedValue: {
		args: getCachedValueArgsSchema,
		success: getCachedValueDataSchema,
		result: getCachedValueResultSchema,
	},
	setCachedValue: {
		args: setCachedValueArgsSchema,
		success: setCachedValueDataSchema,
		result: setCachedValueResultSchema,
	},
	claimCachedValue: {
		success: cacheClaimSchema,
		args: claimCachedValueArgsSchema,
		result: claimCachedValueResultSchema,
	},
	getPluginConfigValue: {
		success: jsonValueSchema,
		args: getPluginConfigValueArgsSchema,
		result: getPluginConfigValueResultSchema,
	},
	getSystemConfigValue: {
		success: jsonValueSchema,
		args: getSystemConfigValueArgsSchema,
		result: getSystemConfigValueResultSchema,
	},
	getUserPreferences: {
		success: userPreferencesSchema,
		args: getUserPreferencesArgsSchema,
		result: getUserPreferencesResultSchema,
	},
} as const;

type SandboxHostContract = {
	readonly args: Schema.Constraint;
	readonly success: Schema.Constraint;
};
type SandboxHostMethodMapFromContracts<Contracts extends Record<string, SandboxHostContract>> = {
	readonly [Capability in keyof Contracts]: (
		...args: Contracts[Capability]["args"]["Type"] extends readonly unknown[]
			? Contracts[Capability]["args"]["Type"]
			: never
	) => Effect.Effect<Contracts[Capability]["success"]["Type"], SandboxHostError>;
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
	"getEntities",
	"listEvents",
	"createEvents",
	"getIntegration",
	"getEntitySchemas",
	"listEventSchemas",
	"listIntegrations",
	"executeQueryEngine",
	"ensureUserEntities",
	"changeUserRelationships",
	"upsertGlobalEntities",
	"upsertGlobalRelationships",
] as const;
export const domainSandboxHostCapabilitySchema = Schema.Literals([
	...DOMAIN_SANDBOX_HOST_CAPABILITIES,
]);
export type DomainSandboxHostCapability = Schema.Schema.Type<
	typeof domainSandboxHostCapabilitySchema
>;

const sandboxIdSchema = nonEmptyString;
export const GLOBAL_WRITE_SANDBOX_LIMITS = {
	entityItems: 500,
	relationshipGroups: 50,
	relationshipsTotal: 1_000,
	relationshipsPerGroup: 500,
} as const;
export const USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS = {
	batches: 50,
	changesTotal: 500,
	changesPerBatch: 100,
} as const;
export const USER_ENTITY_WRITE_SANDBOX_LIMITS = {
	items: GLOBAL_WRITE_SANDBOX_LIMITS.entityItems,
} as const;
export const USER_ENTITY_READ_SANDBOX_LIMITS = {
	ids: GLOBAL_WRITE_SANDBOX_LIMITS.entityItems,
} as const;
export const SYSTEM_CRON_SANDBOX_HOST_CAPABILITIES = [
	"upsertGlobalEntities",
	"upsertGlobalRelationships",
] as const;
export const integrationLotSchema = Schema.Literals(["push", "sink", "yank"]);
export const integrationProviderSchema = Schema.String;
export const integrationProviderSettingsSchema = Schema.Record(Schema.String, jsonValueSchema);
export const entityRecordSchema = strictStruct({
	id: Schema.String,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: jsonValueSchema,
	entitySchemaSlug: Schema.String,
	providerId: Schema.NullOr(Schema.String),
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(Schema.String),
});
export type EntityRecord = Schema.Schema.Type<typeof entityRecordSchema>;

export const entitySchemaProviderSchema = strictStruct({
	name: Schema.String,
	providerId: Schema.String,
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
	provider: integrationProviderSchema,
	name: Schema.NullOr(Schema.String),
	webhookUrl: Schema.optional(Schema.String),
	lastFinishedAt: Schema.NullOr(Schema.String),
	providerSpecifics: integrationProviderSettingsSchema,
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
const globalPropertiesSchema = Schema.Record(Schema.String, jsonValueSchema);
export const ensureUserEntityItemSchema = strictStruct({
	name: nonEmptyString,
	entitySchemaSlug: nonEmptyString,
	properties: globalPropertiesSchema,
});
export type EnsureUserEntityItem = Schema.Schema.Type<typeof ensureUserEntityItemSchema>;
export const ensureUserEntityResultSchema = strictStruct({
	entityId: sandboxIdSchema,
	wasInserted: Schema.Boolean,
});
export type EnsureUserEntityResult = Schema.Schema.Type<typeof ensureUserEntityResultSchema>;
export const upsertGlobalEntityItemSchema = strictStruct({
	name: nonEmptyString,
	externalId: nonEmptyString,
	entitySchemaSlug: nonEmptyString,
	properties: globalPropertiesSchema,
	populatedAt: Schema.NullOr(Schema.String),
});
export type UpsertGlobalEntityItem = Schema.Schema.Type<typeof upsertGlobalEntityItemSchema>;
export const upsertGlobalEntitiesOptionsSchema = strictStruct({
	maximumTotal: Schema.optional(
		Schema.Number.pipe(
			Schema.check(Schema.isInt()),
			Schema.check(Schema.isGreaterThanOrEqualTo(0)),
		),
	),
});
export type UpsertGlobalEntitiesOptions = Schema.Schema.Type<
	typeof upsertGlobalEntitiesOptionsSchema
>;
export const upsertGlobalEntityResultSchema = Schema.Union([
	strictStruct({ status: Schema.Literal("skipped") }),
	strictStruct({
		entityId: sandboxIdSchema,
		wasInserted: Schema.Boolean,
		status: Schema.Literal("upserted"),
	}),
]);
export type UpsertGlobalEntityResult = Schema.Schema.Type<typeof upsertGlobalEntityResultSchema>;
export const globalRelationshipSelectorSchema = Schema.Union([
	strictStruct({ type: Schema.Literal("self") }),
	strictStruct({
		anchorEntityId: sandboxIdSchema,
		type: Schema.Literal("anchored"),
		direction: Schema.Literals(["incoming", "outgoing"]),
	}),
]);
export type GlobalRelationshipSelector = Schema.Schema.Type<
	typeof globalRelationshipSelectorSchema
>;
export const upsertGlobalRelationshipItemSchema = strictStruct({
	sourceEntityId: sandboxIdSchema,
	targetEntityId: sandboxIdSchema,
	properties: globalPropertiesSchema,
});
export type UpsertGlobalRelationshipItem = Schema.Schema.Type<
	typeof upsertGlobalRelationshipItemSchema
>;
export const upsertGlobalRelationshipGroupSchema = strictStruct({
	relationshipSchemaSlug: nonEmptyString,
	selector: globalRelationshipSelectorSchema,
	relationships: Schema.Array(upsertGlobalRelationshipItemSchema).pipe(
		Schema.check(Schema.isMaxLength(GLOBAL_WRITE_SANDBOX_LIMITS.relationshipsPerGroup)),
	),
});
export type UpsertGlobalRelationshipGroup = Schema.Schema.Type<
	typeof upsertGlobalRelationshipGroupSchema
>;
export const upsertGlobalRelationshipResultSchema = strictStruct({
	deleted: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
	upserted: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
});
export type UpsertGlobalRelationshipResult = Schema.Schema.Type<
	typeof upsertGlobalRelationshipResultSchema
>;
const userRelationshipIdentitySchema = strictStruct({
	sourceEntityId: sandboxIdSchema,
	targetEntityId: sandboxIdSchema,
	relationshipSchemaSlug: nonEmptyString,
});
export const createUserRelationshipSchema = strictStruct({
	...userRelationshipIdentitySchema.fields,
	properties: globalPropertiesSchema,
});
export const changeUserRelationshipBatchSchema = strictStruct({
	creates: Schema.Array(createUserRelationshipSchema),
	deletes: Schema.Array(userRelationshipIdentitySchema),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(batch) =>
				batch.creates.length + batch.deletes.length <=
				USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS.changesPerBatch,
		),
	),
	Schema.annotate({ parseOptions: { onExcessProperty: "error" as const } }),
);
export type ChangeUserRelationshipBatch = Schema.Schema.Type<
	typeof changeUserRelationshipBatchSchema
>;
export const changeUserRelationshipResultSchema = strictStruct({
	created: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
	deleted: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
});
export const createEventsResultDataSchema = strictStruct({
	count: Schema.Number.pipe(Schema.check(Schema.isInt())),
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
export const queryDocumentSchema = jsonValueSchema;
export type QueryDocument = Schema.Schema.Type<typeof queryDocumentSchema>;
export type ListIntegrationsOptions = Schema.Schema.Type<typeof listIntegrationsOptionsSchema>;

export const getIntegrationArgsSchema = Schema.Tuple([]);
export const executeQueryEngineDataSchema = Schema.Unknown;
export const getEntitiesArgsSchema = Schema.Tuple([
	Schema.Array(sandboxIdSchema).pipe(
		Schema.check(Schema.isMaxLength(USER_ENTITY_READ_SANDBOX_LIMITS.ids)),
	),
]);
export const getEntitySchemasArgsSchema = Schema.Tuple([
	Schema.Array(sandboxIdSchema).pipe(
		Schema.check(Schema.isMaxLength(USER_ENTITY_READ_SANDBOX_LIMITS.ids)),
	),
]);
export const listEventSchemasArgsSchema = Schema.Tuple([sandboxIdSchema]);
export const listEventsDataSchema = Schema.Array(eventRecordSchema);
export const executeQueryEngineArgsSchema = Schema.Tuple([queryDocumentSchema]);
export const getEntitiesDataSchema = Schema.Array(entityRecordSchema);
export const getEntitiesResultSchema = hostResultSchema(getEntitiesDataSchema);
export const listEventsResultSchema = hostResultSchema(listEventsDataSchema);
export const listEventSchemasDataSchema = Schema.Array(eventSchemaRecordSchema);
export const listIntegrationsDataSchema = Schema.Array(integrationRecordSchema);
export const getIntegrationResultSchema = hostResultSchema(integrationRecordSchema);
export const getEntitySchemasResultSchema = hostResultSchema(
	Schema.Array(entitySchemaRecordSchema),
);
export const createEventsResultSchema = hostResultSchema(createEventsResultDataSchema);
export const createEventsArgsSchema = Schema.Tuple([Schema.Array(createEventItemSchema)]);
export const listEventSchemasResultSchema = hostResultSchema(listEventSchemasDataSchema);
export const listIntegrationsResultSchema = hostResultSchema(listIntegrationsDataSchema);
export const upsertGlobalEntitiesDataSchema = Schema.Array(upsertGlobalEntityResultSchema);
export const executeQueryEngineResultSchema = hostResultSchema(executeQueryEngineDataSchema);
export const listEventsArgsSchema = Schema.Tuple([Schema.optionalKey(listEventsQuerySchema)]);
export const upsertGlobalEntitiesResultSchema = hostResultSchema(upsertGlobalEntitiesDataSchema);
export const listIntegrationsArgsSchema = Schema.Tuple([
	Schema.optionalKey(listIntegrationsOptionsSchema),
]);
export const upsertGlobalRelationshipsDataSchema = Schema.Array(
	upsertGlobalRelationshipResultSchema,
);
export const upsertGlobalRelationshipsResultSchema = hostResultSchema(
	upsertGlobalRelationshipsDataSchema,
);
export const upsertGlobalRelationshipsArgsSchema = Schema.Tuple([
	Schema.Array(upsertGlobalRelationshipGroupSchema).pipe(
		Schema.check(Schema.isMaxLength(GLOBAL_WRITE_SANDBOX_LIMITS.relationshipGroups)),
	),
]);
export const changeUserRelationshipsArgsSchema = Schema.Tuple([
	Schema.Array(changeUserRelationshipBatchSchema).pipe(
		Schema.check(Schema.isMaxLength(USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS.batches)),
	),
]);
export const changeUserRelationshipsDataSchema = Schema.Array(changeUserRelationshipResultSchema);
export const changeUserRelationshipsResultSchema = hostResultSchema(
	changeUserRelationshipsDataSchema,
);
export const ensureUserEntitiesArgsSchema = Schema.Tuple([
	Schema.Array(ensureUserEntityItemSchema).pipe(
		Schema.check(Schema.isMaxLength(USER_ENTITY_WRITE_SANDBOX_LIMITS.items)),
	),
]);
export const ensureUserEntitiesDataSchema = Schema.Array(ensureUserEntityResultSchema);
export const ensureUserEntitiesResultSchema = hostResultSchema(ensureUserEntitiesDataSchema);
export const upsertGlobalEntitiesArgsSchema = Schema.Tuple([
	Schema.Array(upsertGlobalEntityItemSchema).pipe(
		Schema.check(Schema.isMaxLength(GLOBAL_WRITE_SANDBOX_LIMITS.entityItems)),
	),
	Schema.optionalKey(upsertGlobalEntitiesOptionsSchema),
]);

export const domainSandboxHostContracts = {
	getEntities: {
		args: getEntitiesArgsSchema,
		success: getEntitiesDataSchema,
		result: getEntitiesResultSchema,
	},
	listEvents: {
		args: listEventsArgsSchema,
		success: listEventsDataSchema,
		result: listEventsResultSchema,
	},
	changeUserRelationships: {
		args: changeUserRelationshipsArgsSchema,
		success: changeUserRelationshipsDataSchema,
		result: changeUserRelationshipsResultSchema,
	},
	ensureUserEntities: {
		args: ensureUserEntitiesArgsSchema,
		success: ensureUserEntitiesDataSchema,
		result: ensureUserEntitiesResultSchema,
	},
	createEvents: {
		args: createEventsArgsSchema,
		result: createEventsResultSchema,
		success: createEventsResultDataSchema,
	},
	upsertGlobalEntities: {
		args: upsertGlobalEntitiesArgsSchema,
		success: upsertGlobalEntitiesDataSchema,
		result: upsertGlobalEntitiesResultSchema,
	},
	getIntegration: {
		args: getIntegrationArgsSchema,
		success: integrationRecordSchema,
		result: getIntegrationResultSchema,
	},
	getEntitySchemas: {
		args: getEntitySchemasArgsSchema,
		result: getEntitySchemasResultSchema,
		success: Schema.Array(entitySchemaRecordSchema),
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
	upsertGlobalRelationships: {
		args: upsertGlobalRelationshipsArgsSchema,
		success: upsertGlobalRelationshipsDataSchema,
		result: upsertGlobalRelationshipsResultSchema,
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
	properties: Schema.Record(Schema.String, jsonValueSchema),
});
export const emitSignalArgsSchema = Schema.Tuple([emitSignalRequestSchema]);
export const emitSignalDataSchema = strictStruct({
	signalId: Schema.String,
	wasCreated: Schema.Boolean,
});
export const emitSignalResultSchema = hostResultSchema(emitSignalDataSchema);
export const sendNotificationArgsSchema = Schema.Tuple([
	Schema.Trim.pipe(Schema.check(Schema.isMinLength(1))),
]);
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

export const FILESYSTEM_GRANT_SANDBOX_CAPABILITIES = ["scratch", "artifact-read"] as const;
export type FilesystemGrantSandboxCapability =
	(typeof FILESYSTEM_GRANT_SANDBOX_CAPABILITIES)[number];

export const SANDBOX_HOST_CAPABILITIES = [
	...CORE_SANDBOX_HOST_CAPABILITIES,
	...DOMAIN_SANDBOX_HOST_CAPABILITIES,
	...AUTOMATION_SANDBOX_HOST_CAPABILITIES,
	...FILESYSTEM_GRANT_SANDBOX_CAPABILITIES,
] as const;
export const sandboxHostCapabilitySchema = Schema.Literals([...SANDBOX_HOST_CAPABILITIES]);
export type SandboxHostCapability = Schema.Schema.Type<typeof sandboxHostCapabilitySchema>;
export type SandboxHostMethodMap = Omit<
	CoreSandboxHostMethodMap,
	"getPluginConfigValue" | "getSystemConfigValue"
> &
	DomainSandboxHostMethodMap &
	AutomationSandboxHostMethodMap & {
		readonly getPluginConfigValue: GetConfigValue;
		readonly getSystemConfigValue: GetConfigValue;
	};
export type SandboxHostImplementationMap<Context> = CoreSandboxHostImplementationMap<Context> &
	DomainSandboxHostImplementationMap<Context> &
	AutomationSandboxHostImplementationMap<Context>;

const manifestStringSchema = Schema.String.pipe(
	Schema.check(Schema.makeFilter((value) => value.length > 0 && value === value.trim())),
);

const manifestSlugSchema = Schema.String.pipe(
	Schema.check(Schema.makeFilter((value) => /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value))),
);

const sandboxManifestBaseFields = {
	slug: manifestSlugSchema,
	name: manifestStringSchema,
	capabilities: Schema.Array(sandboxHostCapabilitySchema),
	requiredPluginConfigKeys: Schema.Array(manifestStringSchema),
	requiredSystemConfigKeys: Schema.Array(manifestStringSchema),
};

export const sandboxManifestSchema = Schema.Union([
	strictStruct({ ...sandboxManifestBaseFields, kind: Schema.Literal("script") }),
	strictStruct({ ...sandboxManifestBaseFields, kind: Schema.Literal("activity") }),
	strictStruct({ ...sandboxManifestBaseFields, kind: Schema.Literal("provider") }),
	strictStruct({ ...sandboxManifestBaseFields, kind: Schema.Literal("operation") }),
	strictStruct({ ...sandboxManifestBaseFields, kind: Schema.Literal("automation") }),
	strictStruct({
		...sandboxManifestBaseFields,
		capabilities: Schema.Tuple([]),
		kind: Schema.Literal("workflow"),
	}),
]);

export type SandboxManifest = Schema.Schema.Type<typeof sandboxManifestSchema>;
export type ScriptManifest = Extract<SandboxManifest, { readonly kind: "script" }>;
export type ActivityManifest = Extract<SandboxManifest, { readonly kind: "activity" }>;
export type WorkflowManifest = Extract<SandboxManifest, { readonly kind: "workflow" }>;
export type OperationManifest = Extract<SandboxManifest, { readonly kind: "operation" }>;

export const executionMetadataSchema = strictStruct({
	metadata: jsonValueSchema,
	sandboxScriptId: nonEmptyString,
});

export type ExecutionMetadata = Schema.Schema.Type<typeof executionMetadataSchema>;
// Filesystem grants are per-execution Deno permissions, never callable host functions, so they are
// excluded from the host surface a script sees.
export type SandboxHost<Capabilities extends readonly SandboxHostCapability[]> = Readonly<
	Pick<SandboxHostMethodMap, Exclude<Capabilities[number], FilesystemGrantSandboxCapability>>
>;
