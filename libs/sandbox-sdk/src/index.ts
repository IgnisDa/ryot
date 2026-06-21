import * as z from "zod";

export { z };

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

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

export type CoreSandboxHostMethodMap = {
	readonly httpCall: (
		...args: z.output<typeof httpCallArgsSchema>
	) => Promise<z.output<typeof httpCallResultSchema>>;
	readonly getCachedValue: (
		...args: z.output<typeof getCachedValueArgsSchema>
	) => Promise<z.output<typeof getCachedValueResultSchema>>;
	readonly setCachedValue: (
		...args: z.output<typeof setCachedValueArgsSchema>
	) => Promise<z.output<typeof setCachedValueResultSchema>>;
	readonly claimCachedValue: (
		...args: z.output<typeof claimCachedValueArgsSchema>
	) => Promise<z.output<typeof claimCachedValueResultSchema>>;
	readonly getAppConfigValue: (
		...args: z.output<typeof getAppConfigValueArgsSchema>
	) => Promise<z.output<typeof getAppConfigValueResultSchema>>;
	readonly getUserPreferences: (
		...args: z.output<typeof getUserPreferencesArgsSchema>
	) => Promise<z.output<typeof getUserPreferencesResultSchema>>;
};

export type CoreSandboxHostImplementationMap<Context> = {
	readonly [Capability in CoreSandboxHostCapability]: (
		context: Context,
		...args: Parameters<CoreSandboxHostMethodMap[Capability]>
	) => ReturnType<CoreSandboxHostMethodMap[Capability]>;
};

const manifestStringSchema = z
	.string()
	.min(1)
	.refine((value) => value === value.trim(), "Must not have leading or trailing whitespace");

export const sandboxManifestSchema = z
	.object({
		name: manifestStringSchema,
		kind: z.literal("script"),
		requiredAppConfigKeys: z.array(manifestStringSchema),
		slug: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
		capabilities: z.array(coreSandboxHostCapabilitySchema),
	})
	.strict();

export type SandboxManifest = z.infer<typeof sandboxManifestSchema>;

export const executionMetadataSchema = z
	.object({
		metadata: jsonValueSchema,
		sandboxScriptId: z.string().min(1),
	})
	.strict();

export type ExecutionMetadata = z.infer<typeof executionMetadataSchema>;
export type SandboxHost<Capabilities extends readonly CoreSandboxHostCapability[]> = Readonly<
	Pick<CoreSandboxHostMethodMap, Capabilities[number]>
>;

export type GenericDriver<
	Input extends z.ZodType,
	Output extends z.ZodType,
	Capabilities extends readonly CoreSandboxHostCapability[],
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
	const Manifest extends SandboxManifest,
	const Drivers extends Record<string, unknown>,
>(definition: {
	readonly manifest: Manifest;
	readonly drivers: Drivers;
}) => ({
	...definition,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
});
