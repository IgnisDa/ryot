import { Schema } from "effect";

export const SandboxBoundaryReason = Schema.Union([
	Schema.Struct({
		code: Schema.Literal("missing-required-config"),
		keys: Schema.optional(Schema.Array(Schema.String)),
	}),
	Schema.Struct({
		operation: Schema.optional(Schema.String),
		code: Schema.Literals([
			"missing-artifact-grant",
			"unavailable-operation",
			"invalid-executable-target",
			"execution-limit",
		]),
	}),
]);

export type SandboxBoundaryReason = Schema.Codec.Encoded<typeof SandboxBoundaryReason>;
