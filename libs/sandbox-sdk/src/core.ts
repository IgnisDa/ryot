import * as z from "@ryot/sandbox-sdk/zod";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
	| JsonPrimitive
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.boolean(),
		z.number(),
		z.string(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(z.string(), jsonValueSchema),
	]),
);

export const hostFailureSchema = z
	.object({ error: z.string(), success: z.literal(false) })
	.strict();

export const hostResultSchema = <Data extends z.ZodType>(data: Data) =>
	z.discriminatedUnion("success", [
		hostFailureSchema,
		z.object({ data, success: z.literal(true) }).strict(),
	]);

export type HostFailure = z.infer<typeof hostFailureSchema>;
export type HostResult<Data> = HostFailure | { data: Data; success: true };

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
) => Promise<HostResult<SandboxAppConfigValue<Key>>>;

export const unwrapHostResult = <Data>(result: HostResult<Data>) => {
	if (!result.success) {
		throw new Error(result.error);
	}

	return result.data;
};

export const CORE_SANDBOX_HOST_CAPABILITIES = [
	"httpCall",
	"getCachedValue",
	"setCachedValue",
	"claimCachedValue",
	"getAppConfigValue",
	"getUserPreferences",
] as const;

export const coreSandboxHostCapabilitySchema = z.enum(CORE_SANDBOX_HOST_CAPABILITIES);

export type CoreSandboxHostCapability = z.infer<typeof coreSandboxHostCapabilitySchema>;

const cacheKeySchema = z.string().min(1);
const cacheTtlSecondsSchema = z.int().positive();

export const httpCallOptionsSchema = z
	.object({
		body: z.string().optional(),
		headers: z.record(z.string(), z.string()).optional(),
	})
	.strict();

export const httpCallResponseSchema = z
	.object({
		status: z.int(),
		body: z.string(),
		headers: z.record(z.string(), z.string()),
	})
	.strict();

export const httpCallFailureDetailsSchema = z.object({ status: z.int() }).strict();

export const httpCallArgsSchema = z.tuple([
	z.string(),
	z.string(),
	httpCallOptionsSchema.optional(),
]);
export const httpCallResultSchema = z.discriminatedUnion("success", [
	hostFailureSchema.extend({ data: httpCallFailureDetailsSchema.optional() }),
	z.object({ data: httpCallResponseSchema, success: z.literal(true) }).strict(),
]);

export const getCachedValueArgsSchema = z.tuple([cacheKeySchema]);
export const getCachedValueResultSchema = hostResultSchema(jsonValueSchema.nullable());

export const setCachedValueArgsSchema = z.tuple([
	cacheKeySchema,
	jsonValueSchema,
	cacheTtlSecondsSchema,
]);
export const setCachedValueResultSchema = hostResultSchema(z.null());

export const cacheClaimSchema = z.discriminatedUnion("claimed", [
	z.object({ claimed: z.literal(true) }).strict(),
	z.object({ claimed: z.literal(false), value: jsonValueSchema.nullable() }).strict(),
]);
export const claimCachedValueArgsSchema = z.tuple([
	cacheKeySchema,
	jsonValueSchema,
	cacheTtlSecondsSchema,
]);
export const claimCachedValueResultSchema = hostResultSchema(cacheClaimSchema);

export const getAppConfigValueArgsSchema = z.tuple([z.string().min(1)]);
export const getAppConfigValueResultSchema = hostResultSchema(jsonValueSchema);

export const userPreferencesSchema = z
	.object({
		isNsfw: z.boolean(),
		disableIntegrations: z.boolean(),
	})
	.strict();
export const getUserPreferencesArgsSchema = z.tuple([]);
export const getUserPreferencesResultSchema = hostResultSchema(userPreferencesSchema);

export const coreSandboxHostContracts = {
	httpCall: { args: httpCallArgsSchema, result: httpCallResultSchema },
	getCachedValue: { args: getCachedValueArgsSchema, result: getCachedValueResultSchema },
	setCachedValue: { args: setCachedValueArgsSchema, result: setCachedValueResultSchema },
	claimCachedValue: { args: claimCachedValueArgsSchema, result: claimCachedValueResultSchema },
	getAppConfigValue: { args: getAppConfigValueArgsSchema, result: getAppConfigValueResultSchema },
	getUserPreferences: {
		args: getUserPreferencesArgsSchema,
		result: getUserPreferencesResultSchema,
	},
} as const;

type SandboxHostMethodMapFromContracts<
	Contracts extends Record<
		string,
		{ readonly args: z.ZodType<unknown[]>; readonly result: z.ZodType }
	>,
> = {
	readonly [Capability in keyof Contracts]: (
		...args: z.output<Contracts[Capability]["args"]>
	) => Promise<z.output<Contracts[Capability]["result"]>>;
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

export const domainSandboxHostCapabilitySchema = z.enum(DOMAIN_SANDBOX_HOST_CAPABILITIES);

export type DomainSandboxHostCapability = z.infer<typeof domainSandboxHostCapabilitySchema>;

const sandboxIdSchema = z.string().min(1);

export const integrationLotSchema = z.enum(["push", "sink", "yank"]);

export const integrationProviderSchema = z.enum([
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
]);

export const entityRecordSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		createdAt: z.string(),
		updatedAt: z.string(),
		entitySchemaSlug: z.string(),
		properties: jsonValueSchema,
		externalId: z.string().nullable(),
		populatedAt: z.string().nullable(),
		sandboxScriptId: z.string().nullable(),
	})
	.strict();

export type EntityRecord = z.infer<typeof entityRecordSchema>;

export const entitySchemaProviderSchema = z
	.object({ name: z.string(), scriptId: z.string() })
	.strict();

export const entitySchemaRecordSchema = z
	.object({
		id: z.string(),
		icon: z.string(),
		name: z.string(),
		slug: z.string(),
		isBuiltin: z.boolean(),
		trackerId: z.string(),
		accentColor: z.string(),
		propertiesSchema: jsonValueSchema,
		providers: z.array(entitySchemaProviderSchema).readonly(),
	})
	.strict();

export type EntitySchemaRecord = z.infer<typeof entitySchemaRecordSchema>;

export const eventSchemaRecordSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		slug: z.string(),
		entitySchemaSlug: z.string(),
		propertiesSchema: jsonValueSchema,
	})
	.strict();

export type EventSchemaRecord = z.infer<typeof eventSchemaRecordSchema>;

export const eventRecordSchema = z
	.object({
		id: z.string(),
		entityId: z.string(),
		createdAt: z.string(),
		updatedAt: z.string(),
		occurredAt: z.string(),
		eventSchemaName: z.string(),
		eventSchemaSlug: z.string(),
		properties: jsonValueSchema,
		sessionEntityId: z.string().optional(),
	})
	.strict();

export type EventRecord = z.infer<typeof eventRecordSchema>;

export const integrationRecordSchema = z
	.object({
		id: z.string(),
		userId: z.string(),
		createdAt: z.string(),
		updatedAt: z.string(),
		isDisabled: z.boolean(),
		lot: integrationLotSchema,
		syncOwnership: z.boolean(),
		name: z.string().nullable(),
		minimumProgress: z.number(),
		maximumProgress: z.number(),
		webhookUrl: z.string().optional(),
		providerSpecifics: jsonValueSchema,
		provider: integrationProviderSchema,
		lastFinishedAt: z.string().nullable(),
		extraSettings: z.object({ disableOnContinuousErrors: z.boolean() }).strict(),
	})
	.strict();

export type IntegrationRecord = z.infer<typeof integrationRecordSchema>;

export const createEventItemSchema = z
	.object({
		entityId: sandboxIdSchema,
		properties: jsonValueSchema,
		eventSchemaSlug: sandboxIdSchema,
		occurredAt: z.string().optional(),
		sessionEntityId: sandboxIdSchema.optional(),
	})
	.strict();

export type CreateEventItem = z.infer<typeof createEventItemSchema>;

export const createEventsResultDataSchema = z.object({ count: z.int() }).strict();

export const listEventsQuerySchema = z
	.object({
		entityId: sandboxIdSchema.optional(),
		eventSchemaSlug: z.string().optional(),
		sessionEntityId: sandboxIdSchema.optional(),
	})
	.strict();

export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

export const listIntegrationsOptionsSchema = z
	.object({
		isDisabled: z.boolean().optional(),
		provider: integrationProviderSchema.optional(),
	})
	.strict();

export type ListIntegrationsOptions = z.infer<typeof listIntegrationsOptionsSchema>;

export const queryDocumentSchema = jsonValueSchema;

export type QueryDocument = z.infer<typeof queryDocumentSchema>;

export const getEntityArgsSchema = z.tuple([sandboxIdSchema]);
export const getEntityResultSchema = hostResultSchema(entityRecordSchema);

export const getEntitySchemaArgsSchema = z.tuple([sandboxIdSchema]);
export const getEntitySchemaResultSchema = hostResultSchema(entitySchemaRecordSchema);

export const getIntegrationArgsSchema = z.tuple([sandboxIdSchema]);
export const getIntegrationResultSchema = hostResultSchema(integrationRecordSchema);

export const listEventSchemasArgsSchema = z.tuple([sandboxIdSchema]);
export const listEventSchemasResultSchema = hostResultSchema(
	z.array(eventSchemaRecordSchema).readonly(),
);

export const listEventsArgsSchema = z.tuple([listEventsQuerySchema.optional()]);
export const listEventsResultSchema = hostResultSchema(z.array(eventRecordSchema).readonly());

export const listIntegrationsArgsSchema = z.tuple([listIntegrationsOptionsSchema.optional()]);
export const listIntegrationsResultSchema = hostResultSchema(
	z.array(integrationRecordSchema).readonly(),
);

export const createEventsArgsSchema = z.tuple([z.array(createEventItemSchema)]);
export const createEventsResultSchema = hostResultSchema(createEventsResultDataSchema);

export const executeQueryEngineArgsSchema = z.tuple([queryDocumentSchema]);
export const executeQueryEngineResultSchema = hostResultSchema(z.unknown());

export const domainSandboxHostContracts = {
	getEntity: { args: getEntityArgsSchema, result: getEntityResultSchema },
	listEvents: { args: listEventsArgsSchema, result: listEventsResultSchema },
	createEvents: { args: createEventsArgsSchema, result: createEventsResultSchema },
	getIntegration: { args: getIntegrationArgsSchema, result: getIntegrationResultSchema },
	getEntitySchema: { args: getEntitySchemaArgsSchema, result: getEntitySchemaResultSchema },
	listEventSchemas: { args: listEventSchemasArgsSchema, result: listEventSchemasResultSchema },
	listIntegrations: { args: listIntegrationsArgsSchema, result: listIntegrationsResultSchema },
	executeQueryEngine: {
		args: executeQueryEngineArgsSchema,
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

export const emitSignalRequestSchema = z
	.object({
		schemaSlug: z.string().min(1),
		discriminator: z.string().min(1),
		subjectEntityId: sandboxIdSchema.optional(),
		properties: z.record(z.string(), jsonValueSchema),
	})
	.strict();
export const emitSignalArgsSchema = z.tuple([emitSignalRequestSchema]);
export const emitSignalResultSchema = hostResultSchema(
	z.object({ signalId: z.string(), wasCreated: z.boolean() }).strict(),
);

export const sendNotificationArgsSchema = z.tuple([z.string().trim().min(1)]);

export const automationSandboxHostContracts = {
	emitSignal: { args: emitSignalArgsSchema, result: emitSignalResultSchema },
	sendNotification: { args: sendNotificationArgsSchema, result: hostResultSchema(z.null()) },
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

export const sandboxHostCapabilitySchema = z.enum(SANDBOX_HOST_CAPABILITIES);

export type SandboxHostCapability = z.infer<typeof sandboxHostCapabilitySchema>;

export type SandboxHostMethodMap = Omit<CoreSandboxHostMethodMap, "getAppConfigValue"> &
	DomainSandboxHostMethodMap &
	AutomationSandboxHostMethodMap & { readonly getAppConfigValue: GetAppConfigValue };

export type SandboxHostImplementationMap<Context> = CoreSandboxHostImplementationMap<Context> &
	DomainSandboxHostImplementationMap<Context> &
	AutomationSandboxHostImplementationMap<Context>;

const manifestStringSchema = z
	.string()
	.min(1)
	.refine((value) => value === value.trim(), "Must not have leading or trailing whitespace");

export const providerInformationSchema = z
	.object({ source: manifestStringSchema, canonicalLanguage: manifestStringSchema.optional() })
	.strict();

const sandboxManifestBaseSchema = z.object({
	name: manifestStringSchema,
	capabilities: z.array(sandboxHostCapabilitySchema),
	requiredAppConfigKeys: z.array(manifestStringSchema),
	slug: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
});

export const sandboxManifestSchema = z.discriminatedUnion("kind", [
	sandboxManifestBaseSchema.extend({ kind: z.literal("script") }).strict(),
	sandboxManifestBaseSchema.extend({ kind: z.literal("automation") }).strict(),
	sandboxManifestBaseSchema
		.extend({ kind: z.literal("provider"), providerInformation: providerInformationSchema })
		.strict(),
]);

export type SandboxManifest = z.infer<typeof sandboxManifestSchema>;
export type ScriptManifest = Extract<SandboxManifest, { kind: "script" }>;
export type ProviderInformation = z.infer<typeof providerInformationSchema>;

export const executionMetadataSchema = z
	.object({ metadata: jsonValueSchema, sandboxScriptId: z.string().min(1) })
	.strict();

export type ExecutionMetadata = z.infer<typeof executionMetadataSchema>;
export type SandboxHost<Capabilities extends readonly SandboxHostCapability[]> = Readonly<
	Pick<SandboxHostMethodMap, Capabilities[number]>
>;

export type GenericDriver<
	Input extends z.ZodType,
	Output extends z.ZodType,
	Capabilities extends readonly SandboxHostCapability[],
> = {
	readonly input: Input;
	readonly output: Output;
	readonly run: (
		input: z.output<Input>,
		host: SandboxHost<Capabilities>,
		execution: ExecutionMetadata,
	) => Promise<z.output<Output>>;
};

export const defineManifest = <const Manifest extends SandboxManifest>(manifest: Manifest) =>
	manifest;

export const defineDriver = <
	const Manifest extends SandboxManifest,
	Input extends z.ZodType,
	Output extends z.ZodType,
>(
	_manifest: Manifest,
	driver: GenericDriver<Input, Output, Manifest["capabilities"]>,
) => driver;

export const SANDBOX_SCRIPT_DEFINITION = "ryot:sandbox-script" as const;

export type GenericScriptDefinition<
	Manifest extends SandboxManifest,
	Drivers extends Record<string, unknown>,
> = {
	readonly manifest: Manifest;
	readonly drivers: Drivers;
	readonly definitionType: typeof SANDBOX_SCRIPT_DEFINITION;
};

export const defineScript = <
	const Manifest extends ScriptManifest,
	const Drivers extends Record<string, unknown>,
>(definition: {
	readonly manifest: Manifest;
	readonly drivers: Drivers;
}) => ({ ...definition, definitionType: SANDBOX_SCRIPT_DEFINITION });
