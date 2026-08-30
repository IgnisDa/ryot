import { Schema } from "effect";

export const SANDBOX_RUNTIME_PAYLOAD_FORMAT = 1 as const;

const sha256Schema = Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)));
const byteLengthSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

const sandboxRuntimePayloadDependencySchema = Schema.Struct({
	name: Schema.String,
	version: Schema.String,
	sdkImport: Schema.String,
	packageName: Schema.String,
	runtimeFile: Schema.String,
	aliases: Schema.Array(Schema.String),
});

export const sandboxRuntimePayloadMetadataSchema = Schema.Struct({
	denoVersion: Schema.String,
	viteVersion: Schema.String,
	format: Schema.Literal(SANDBOX_RUNTIME_PAYLOAD_FORMAT),
	dependencies: Schema.Array(sandboxRuntimePayloadDependencySchema),
	files: Schema.Array(
		Schema.Struct({ path: Schema.String, sha256: sha256Schema, byteLength: byteLengthSchema }),
	),
});

export const sandboxRuntimePayloadSchema = Schema.Struct({
	contentHash: sha256Schema,
	metadata: sandboxRuntimePayloadMetadataSchema,
	files: Schema.Array(Schema.Struct({ path: Schema.String, contents: Schema.String })),
});

export type SandboxRuntimePayloadMetadata = Schema.Schema.Type<
	typeof sandboxRuntimePayloadMetadataSchema
>;
export type SandboxRuntimePayload = Schema.Schema.Type<typeof sandboxRuntimePayloadSchema>;
