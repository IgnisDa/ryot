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

const manifestStringSchema = z
	.string()
	.min(1)
	.refine((value) => value === value.trim(), "Must not have leading or trailing whitespace");

export const sandboxManifestSchema = z
	.object({
		name: manifestStringSchema,
		kind: z.literal("script"),
		capabilities: z.array(manifestStringSchema),
		requiredAppConfigKeys: z.array(manifestStringSchema),
		slug: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
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
export type SandboxHost<_Capabilities extends readonly string[]> = Readonly<Record<never, never>>;

export type GenericDriver<
	Input extends z.ZodType,
	Output extends z.ZodType,
	Capabilities extends readonly string[],
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
