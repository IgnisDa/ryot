import { Schema } from "effect";

import { PluginId } from "../../schema/brands";

export const PluginInstallationUnavailableReason = Schema.Struct({
	pluginId: PluginId,
	installationId: Schema.String,
	code: Schema.Literals(["installation-unavailable", "package-identity-conflict"]),
});

export type PluginInstallationUnavailableReason = typeof PluginInstallationUnavailableReason.Type;

export const SandboxBoundaryReason = Schema.Union([
	PluginInstallationUnavailableReason,
	Schema.Struct({ code: Schema.Literal("asset-forbidden") }),
	Schema.Struct({ code: Schema.Literal("operation-rejected") }),
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

const decodeBoundaryReason = Schema.decodeUnknownSync(SandboxBoundaryReason, {
	onExcessProperty: "error",
});

export const boundaryReasonOfError = (error: unknown) => {
	try {
		return decodeBoundaryReason(
			typeof error === "object" && error !== null && "data" in error ? error.data : undefined,
		);
	} catch {
		return undefined;
	}
};
