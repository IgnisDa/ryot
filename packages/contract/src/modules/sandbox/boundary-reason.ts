import { Schema } from "effect";

import { PluginId } from "../../schema/brands";

export const SandboxBoundaryReason = Schema.Union([
	Schema.Struct({
		pluginId: PluginId,
		installationId: Schema.String,
		code: Schema.Literals(["installation-unavailable", "package-identity-conflict"]),
	}),
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
