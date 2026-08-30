import { Schema } from "effect";

import { PluginSlug, SavedViewId } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { SandboxCompilationDiagnostic, SandboxExecutionError } from "../sandbox/schemas";
import { PluginConfigSchema } from "./manifest";

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
	"source-non-utf8",
	"manifest-invalid",
	"unexpected-entry",
	"missing-manifest",
	"path-noncanonical",
	"duplicate-manifest",
	"path-bytes-exceeded",
	"entry-count-exceeded",
	"source-bytes-exceeded",
	"unsupported-compression",
	"manifest-bytes-exceeded",
	"compressed-bytes-exceeded",
	"total-uncompressed-bytes-exceeded",
]);

/**
 * Plugins occupy the first client URL segment, so a plugin slug matching a global client route
 * would make either the route or the plugin unreachable. Plugin activation rejects these names.
 */
export const reservedPluginSlugs: ReadonlySet<string> = new Set([
	"e",
	"v",
	"auth",
	"oauth",
	"settings",
	"god-mode",
	"onboarding",
	"reset-password",
	"customize-sidebar",
]);

const PluginRequestFailureReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("upload-unavailable") }),
	Schema.Struct({ pluginSlug: PluginSlug, code: Schema.Literal("slug-reserved") }),
	Schema.Struct({ savedViewId: SavedViewId, code: Schema.Literal("home-view-disabled") }),
	Schema.Struct({ savedViewId: SavedViewId, code: Schema.Literal("home-view-not-found") }),
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
		code: Schema.Literal("package-limit-exceeded"),
		limit: Schema.Literals(["file-count", "total-bytes", "script-count"]),
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
		pluginSlug: PluginSlug,
		operationSlug: Schema.String,
		code: Schema.Literal("invalid-operation-scope"),
	}),
	Schema.Struct({
		savedViewId: SavedViewId,
		code: Schema.Literal("home-view-renderer-unavailable"),
	}),
]);

const PluginConflictReason = Schema.Union([
	Schema.Struct({ pluginSlug: PluginSlug, code: Schema.Literal("system-plugin") }),
	Schema.Struct({ pluginSlug: PluginSlug, code: Schema.Literal("boot-configured") }),
	Schema.Struct({ pluginSlug: PluginSlug, code: Schema.Literal("already-installed") }),
	Schema.Struct({ pluginSlug: PluginSlug, code: Schema.Literal("entity-referenced") }),
	Schema.Struct({ pluginSlug: PluginSlug, code: Schema.Literal("workflow-referenced") }),
	Schema.Struct({ pluginSlug: PluginSlug, code: Schema.Literal("source-revision-stale") }),
	Schema.Struct({ pluginSlug: PluginSlug, code: Schema.Literal("saved-view-referenced") }),
	Schema.Struct({ pluginSlug: PluginSlug, code: Schema.Literal("integration-referenced") }),
	Schema.Struct({
		pluginSlug: PluginSlug,
		code: Schema.Literal("definition-referenced"),
		diagnostics: Schema.Array(PluginValidationDiagnostic),
	}),
	Schema.Struct({
		pluginSlug: PluginSlug,
		code: Schema.Literal("installation-not-ready"),
		health: Schema.Literals(["failed", "installing", "incompatible", "needs-configuration"]),
	}),
]);

const PluginNotFoundReason = Schema.Union([
	Schema.Struct({ pluginSlug: PluginSlug, code: Schema.Literal("plugin-not-found") }),
	Schema.Struct({
		pluginSlug: PluginSlug,
		operationSlug: Schema.String,
		code: Schema.Literal("operation-not-found"),
	}),
	Schema.Struct({
		pluginSlug: PluginSlug,
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

export class PluginRequestError extends Schema.TaggedError<PluginRequestError>()(
	"PluginRequestError",
	{ reason: PluginRequestFailureReason },
) {}

export class PluginConflictError extends Schema.TaggedError<PluginConflictError>()(
	"PluginConflictError",
	{ reason: PluginConflictReason },
) {}

export class PluginNotFoundError extends Schema.TaggedError<PluginNotFoundError>()(
	"PluginNotFoundError",
	{ reason: PluginNotFoundReason },
) {}

export class PluginInvocationError extends Schema.TaggedError<PluginInvocationError>()(
	"PluginInvocationError",
	{ reason: PluginInvocationFailureReason },
) {}

export const InstallPluginBody = Schema.Struct({
	uploadToken: Schema.String,
	config: Schema.Record(Schema.String, JsonValue),
});

export type InstallPluginBody = Schema.Schema.Type<typeof InstallPluginBody>;

export const UpdatePrivatePluginBody = strictStruct({
	uploadToken: Schema.String,
	unsetConfigKeys: Schema.optional(Schema.Array(Schema.String)),
	config: Schema.optional(Schema.Record(Schema.String, JsonValue)),
});

export type UpdatePrivatePluginBody = typeof UpdatePrivatePluginBody.Type;

export const UpdatePluginInstallationBody = strictStruct({
	isDisabled: Schema.optional(Schema.Boolean),
	unsetConfigKeys: Schema.optional(Schema.Array(Schema.String)),
	config: Schema.optional(Schema.Record(Schema.String, JsonValue)),
	sortOrder: Schema.optional(
		Schema.Int.pipe(
			Schema.check(Schema.isBetween({ maximum: 2_147_483_647, minimum: -2_147_483_648 })),
		),
	),
});

export type UpdatePluginInstallationBody = typeof UpdatePluginInstallationBody.Type;

export const PluginHomeViewSelection = strictStruct({ savedViewId: Schema.NullOr(SavedViewId) });

export type PluginHomeViewSelection = typeof PluginHomeViewSelection.Type;

export const PluginInstallationHealth = Schema.Literals([
	"ready",
	"failed",
	"installing",
	"incompatible",
	"needs-configuration",
]);

export const PluginInstallationItem = Schema.Struct({
	slug: PluginSlug,
	icon: Schema.String,
	name: Schema.String,
	version: Schema.String,
	sortOrder: Schema.Number,
	sourceHash: Schema.String,
	isDisabled: Schema.Boolean,
	description: Schema.String,
	configSchema: PluginConfigSchema,
	health: PluginInstallationHealth,
	healthReason: Schema.NullOr(Schema.String),
	scope: Schema.Literals(["system", "user"]),
	homeSavedViewId: Schema.NullOr(SavedViewId),
	configuredSecrets: Schema.Array(Schema.String),
	config: Schema.Record(Schema.String, JsonValue),
});

export type PluginInstallationItem = Schema.Schema.Type<typeof PluginInstallationItem>;

export const PluginInstallationList = Schema.Array(PluginInstallationItem);

export const PluginInvokeBody = Schema.Struct({
	payload: JsonValue,
	sourceHash: Schema.optional(Schema.String),
});

export type PluginInvokeBody = Schema.Schema.Type<typeof PluginInvokeBody>;

export const PluginInvokeResult = Schema.Struct({ result: JsonValue });

export type PluginInvokeResult = Schema.Schema.Type<typeof PluginInvokeResult>;
