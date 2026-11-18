import { LocalMessage, Message, stampNamespace } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Option, Schema } from "effect";

import { PluginId } from "../../schema/brands";
import { EntitlementRequiredReason } from "../../schema/entitlement";
import { CommitConflictCode } from "../mutations/user-command";

export const PluginInstallationUnavailableReason = Schema.Struct({
	pluginId: PluginId,
	installationId: Schema.String,
	code: Schema.Literals(["installation-unavailable", "package-identity-conflict"]),
});

export type PluginInstallationUnavailableReason = typeof PluginInstallationUnavailableReason.Type;

const boundaryReasonMembers = <Reason extends Schema.Top>(reason: Reason) =>
	[
		PluginInstallationUnavailableReason,
		EntitlementRequiredReason,
		Schema.Struct({ code: Schema.Literal("asset-forbidden") }),
		Schema.Struct({ reason, code: Schema.Literal("operation-rejected") }),
		Schema.Struct({ conflict: CommitConflictCode, code: Schema.Literal("operation-conflict") }),
		Schema.Struct({ code: Schema.Literal("page-write-access-required") }),
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
	] as const;

/** The boundary reason a sandbox reports; plugin code builds an operation rejection's local message. */
export const SandboxBoundaryReason = Schema.Union(boundaryReasonMembers(LocalMessage));

export type SandboxBoundaryReason = Schema.Codec.Encoded<typeof SandboxBoundaryReason>;

/** A boundary reason after the kernel stamped the run's plugin namespace on an operation rejection. */
export const StampedSandboxBoundaryReason = Schema.Union(boundaryReasonMembers(Message));

export type StampedSandboxBoundaryReason = typeof StampedSandboxBoundaryReason.Type;

/**
 * Stamps a sandbox's boundary reason with the run's catalog namespace. A run without a catalog
 * (`null`) cannot explain a rejection, so its operation rejection is dropped.
 */
export const stampBoundaryReason = (
	namespace: null | string,
	reason: typeof SandboxBoundaryReason.Type,
): undefined | StampedSandboxBoundaryReason => {
	if (reason.code !== "operation-rejected") {
		return reason;
	}
	return namespace === null
		? undefined
		: { code: reason.code, reason: stampNamespace(namespace, reason.reason) };
};

const decodeBoundaryReason = Schema.decodeUnknownOption(SandboxBoundaryReason, {
	onExcessProperty: "error",
});

export const boundaryReasonOfError = (error: unknown) =>
	Option.getOrUndefined(
		decodeBoundaryReason(
			typeof error === "object" && error !== null && "data" in error ? error.data : undefined,
		),
	);

const decodeStampedBoundaryReason = Schema.decodeUnknownOption(StampedSandboxBoundaryReason, {
	onExcessProperty: "error",
});

/** The stamped boundary reason a kernel-side sandbox failure carries in `data`. */
export const stampedBoundaryReasonOfError = (error: unknown) =>
	Option.getOrUndefined(
		decodeStampedBoundaryReason(
			typeof error === "object" && error !== null && "data" in error ? error.data : undefined,
		),
	);

const boundaryReasonKeys = {
	"asset-forbidden": "error.sandbox.asset-forbidden",
	"execution-limit": "error.sandbox.execution-limit",
	"operation-conflict": "error.sandbox.operation-conflict",
	"unavailable-operation": "error.sandbox.unavailable-operation",
	"missing-artifact-grant": "error.sandbox.missing-artifact-grant",
	"installation-unavailable": "error.sandbox.installation-unavailable",
	"invalid-executable-target": "error.sandbox.invalid-executable-target",
	"package-identity-conflict": "error.sandbox.package-identity-conflict",
	"page-write-access-required": "error.sandbox.page-write-access-required",
} as const;

export const boundaryReasonMessage = (reason: StampedSandboxBoundaryReason): Message => {
	if (reason.code === "operation-rejected") {
		return reason.reason;
	}
	if (reason.code === "entitlement-required") {
		return kernelMessage("error.sandbox.entitlement-required", { entitlement: reason.entitlement });
	}
	if (reason.code === "missing-required-config") {
		return kernelMessage("error.sandbox.missing-required-config", {
			count: reason.keys?.length ?? 0,
		});
	}
	return kernelMessage(boundaryReasonKeys[reason.code]);
};
