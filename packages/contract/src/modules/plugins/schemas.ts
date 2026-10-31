import { Schema } from "effect";

import { PluginId, PluginPackageId } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { SandboxCompilationDiagnostic, SandboxExecutionError } from "../scripts/schemas";
import { SavedViewReference } from "./references";

const PluginValidationDiagnostic = Schema.Struct({
	code: Schema.String,
	message: Schema.String,
	phase: Schema.Literal("validate"),
	severity: Schema.Literal("error"),
});

const PluginCompilerDiagnostic = Schema.Struct({
	...SandboxCompilationDiagnostic.fields,
	phase: Schema.Literal("compile"),
});

const PluginRuntimeDiagnostic = Schema.Struct({
	code: Schema.String,
	severity: Schema.Literal("error"),
	line: SandboxExecutionError.fields.line,
	phase: SandboxExecutionError.fields.phase,
	column: SandboxExecutionError.fields.column,
	message: SandboxExecutionError.fields.message,
});

const PluginSchemaEvolutionIssue = Schema.Struct({
	path: Schema.String,
	code: Schema.Literals([
		"enum-narrowed",
		"schema-changed",
		"schema-removed",
		"property-changed",
		"property-removed",
		"property-type-changed",
		"required-property-added",
	]),
});

const PluginPackageArchiveIssue = Schema.Literals([
	"malformed-zip",
	"path-non-utf8",
	"encrypted-entry",
	"directory-entry",
	"duplicate-entry",
	"manifest-invalid",
	"unexpected-entry",
	"missing-manifest",
	"path-noncanonical",
	"duplicate-manifest",
	"path-bytes-exceeded",
	"entry-count-exceeded",
	"unsupported-compression",
	"manifest-bytes-exceeded",
	"compressed-bytes-exceeded",
	"total-uncompressed-bytes-exceeded",
	"compiled-client-bytes-exceeded",
	"compiled-client-file-count-exceeded",
	"compiled-client-invalid",
	"compiled-client-metadata-bytes-exceeded",
	"compiled-script-bytes-exceeded",
	"compiled-script-invalid",
	"compiled-script-metadata-bytes-exceeded",
]);

const PluginRequestFailureReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("asset-forbidden") }),
	Schema.Struct({ code: Schema.Literal("upload-unavailable") }),
	Schema.Struct({ packageId: PluginPackageId, code: Schema.Literal("reserved-system-identity") }),
	Schema.Struct({ reference: SavedViewReference, code: Schema.Literal("home-view-hidden") }),
	Schema.Struct({ reference: SavedViewReference, code: Schema.Literal("home-view-not-found") }),
	Schema.Struct({
		pluginId: PluginId,
		packageId: PluginPackageId,
		expectedPackageId: PluginPackageId,
		code: Schema.Literal("package-id-mismatch"),
	}),
	Schema.Struct({
		issue: PluginPackageArchiveIssue,
		code: Schema.Literal("package-archive-invalid"),
	}),
	Schema.Struct({
		code: Schema.Literal("validation-failed"),
		diagnostics: Schema.Array(PluginValidationDiagnostic),
	}),
	Schema.Struct({
		code: Schema.Literal("compilation-failed"),
		diagnostics: Schema.Array(PluginCompilerDiagnostic),
	}),
	Schema.Struct({
		surfaces: Schema.Array(Schema.String),
		code: Schema.Literal("unsupported-manifest-surface"),
	}),
	Schema.Struct({
		code: Schema.Literal("schema-evolution-failed"),
		issues: Schema.Array(PluginSchemaEvolutionIssue),
	}),
	Schema.Struct({
		packageId: PluginPackageId,
		operationSlug: Schema.String,
		code: Schema.Literal("invalid-operation-scope"),
	}),
	Schema.Struct({
		reference: SavedViewReference,
		code: Schema.Literal("home-view-renderer-unavailable"),
	}),
]);

const PluginConflictReason = Schema.Union([
	Schema.Struct({ pluginId: PluginId, code: Schema.Literal("system-plugin") }),
	Schema.Struct({ packageId: PluginPackageId, code: Schema.Literal("already-installed") }),
	Schema.Struct({ pluginId: PluginId, code: Schema.Literal("entity-referenced") }),
	Schema.Struct({ pluginId: PluginId, code: Schema.Literal("workflow-referenced") }),
	Schema.Struct({ pluginId: PluginId, code: Schema.Literal("source-revision-stale") }),
	Schema.Struct({ pluginId: PluginId, code: Schema.Literal("saved-view-referenced") }),
	Schema.Struct({ pluginId: PluginId, code: Schema.Literal("integration-referenced") }),
	Schema.Struct({
		pluginId: PluginId,
		packageId: PluginPackageId,
		code: Schema.Literal("package-identity-conflict"),
	}),
	Schema.Struct({
		pluginId: PluginId,
		declarations: Schema.Array(Schema.String),
		code: Schema.Literal("referenced-definition-incompatible"),
	}),
	Schema.Struct({
		pluginId: PluginId,
		code: Schema.Literal("definition-referenced"),
		diagnostics: Schema.Array(PluginValidationDiagnostic),
	}),
	Schema.Struct({
		pluginId: PluginId,
		code: Schema.Literal("installation-not-ready"),
		health: Schema.Literals(["failed", "installing", "incompatible", "needs-configuration"]),
	}),
]);

const PluginNotFoundReason = Schema.Union([
	Schema.Struct({ pluginId: PluginId, code: Schema.Literal("plugin-not-found") }),
	Schema.Struct({ installationId: Schema.String, code: Schema.Literal("installation-not-found") }),
	Schema.Struct({
		packageId: PluginPackageId,
		operationSlug: Schema.String,
		code: Schema.Literal("operation-not-found"),
	}),
	Schema.Struct({
		packageId: PluginPackageId,
		operationSlug: Schema.String,
		code: Schema.Literal("operation-scope-not-found"),
	}),
]);

const PluginInvocationFailureReason = Schema.Union([
	Schema.Struct({
		code: Schema.Literal("runtime-failed"),
		diagnostics: Schema.Array(PluginRuntimeDiagnostic),
	}),
]);

export class PluginConflictError extends Schema.TaggedError<
	PluginConflictError,
	{ readonly brand: unique symbol }
>()("PluginConflictError", { reason: PluginConflictReason }) {}

export class PluginNotFoundError extends Schema.TaggedError<
	PluginNotFoundError,
	{ readonly brand: unique symbol }
>()("PluginNotFoundError", { reason: PluginNotFoundReason }) {}

export class PluginRequestError extends Schema.TaggedError<
	PluginRequestError,
	{ readonly brand: unique symbol }
>()("PluginRequestError", { reason: PluginRequestFailureReason }) {}

export class PluginOperationRejected extends Schema.TaggedError<
	PluginOperationRejected,
	{ readonly brand: unique symbol }
>()("PluginOperationRejected", { message: Schema.String }) {}

export class PluginInvocationError extends Schema.TaggedError<
	PluginInvocationError,
	{ readonly brand: unique symbol }
>()("PluginInvocationError", { reason: PluginInvocationFailureReason }) {}

export const InstallPluginBody = Schema.Struct({
	uploadToken: Schema.String,
	config: Schema.Record(Schema.String, JsonValue),
});

export type InstallPluginBody = Schema.Schema.Type<typeof InstallPluginBody>;

export const UpdatePrivatePluginBody = strictStruct({
	contentHash: Schema.String,
	uploadToken: Schema.String,
	unsetConfigKeys: Schema.optional(Schema.Array(Schema.String)),
	config: Schema.optional(Schema.Record(Schema.String, JsonValue)),
});

export type UpdatePrivatePluginBody = typeof UpdatePrivatePluginBody.Type;

export const UpdatePluginInstallationBody = strictStruct({
	isHidden: Schema.optional(Schema.Boolean),
	unsetConfigKeys: Schema.optional(Schema.Array(Schema.String)),
	config: Schema.optional(Schema.Record(Schema.String, JsonValue)),
	sortOrder: Schema.optional(
		Schema.Int.pipe(
			Schema.check(Schema.isBetween({ maximum: 2_147_483_647, minimum: -2_147_483_648 })),
		),
	),
});

export type UpdatePluginInstallationBody = typeof UpdatePluginInstallationBody.Type;

export const PluginHomeViewSelection = strictStruct({
	savedView: Schema.NullOr(SavedViewReference),
});

export type PluginHomeViewSelection = typeof PluginHomeViewSelection.Type;

export const PluginInstallationHealth = Schema.Literals([
	"ready",
	"failed",
	"installing",
	"incompatible",
	"needs-configuration",
]);

export const PluginInstallationIncompatibilityReason = Schema.Literal("package-identity-conflict");
export type PluginInstallationIncompatibilityReason =
	typeof PluginInstallationIncompatibilityReason.Type;

export const PluginInstallationWriteResult = Schema.Struct({
	id: Schema.String,
	pluginId: PluginId,
});

export const PluginInstallResult = Schema.Struct({
	...PluginInstallationWriteResult.fields,
	activationId: Schema.String,
});

export const PluginInvokeBody = Schema.Struct({
	payload: JsonValue,
	contentHash: Schema.optional(Schema.String),
	idempotencyKey: Schema.optional(Schema.NonEmptyString),
});

export type PluginInvokeBody = Schema.Schema.Type<typeof PluginInvokeBody>;

export const PluginInvokeResult = Schema.Struct({ result: JsonValue });

export type PluginInvokeResult = Schema.Schema.Type<typeof PluginInvokeResult>;
