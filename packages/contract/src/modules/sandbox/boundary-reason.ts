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
		keys: Schema.optionalKey(Schema.Array(Schema.String)),
	}),
	Schema.Struct({
		operation: Schema.optionalKey(Schema.String),
		code: Schema.Literals([
			"missing-artifact-grant",
			"unavailable-operation",
			"invalid-executable-target",
			"execution-limit",
		]),
	}),
]);

export type SandboxBoundaryReason = Schema.Codec.Encoded<typeof SandboxBoundaryReason>;
