import { Schema } from "effect";

import { PluginSlug } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import { SandboxCompilationDiagnostic, SandboxExecutionError } from "../sandbox/schemas";
import { PluginConfigSchema, PluginManifest } from "./manifest";

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
	line: SandboxExecutionError.fields.line,
	severity: Schema.Literal("error"),
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

const PluginRequestFailureReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("slug-reserved"), pluginSlug: PluginSlug }),
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
		issues: Schema.Array(PluginSchemaEvolutionIssue),
		code: Schema.Literal("schema-evolution-failed"),
	}),
	Schema.Struct({
		pluginSlug: PluginSlug,
		operationSlug: Schema.String,
		code: Schema.Literal("invalid-operation-scope"),
	}),
]);

const PluginConflictReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("system-plugin"), pluginSlug: PluginSlug }),
	Schema.Struct({ code: Schema.Literal("boot-configured"), pluginSlug: PluginSlug }),
	Schema.Struct({ code: Schema.Literal("already-installed"), pluginSlug: PluginSlug }),
	Schema.Struct({ code: Schema.Literal("entity-referenced"), pluginSlug: PluginSlug }),
	Schema.Struct({ code: Schema.Literal("workflow-referenced"), pluginSlug: PluginSlug }),
	Schema.Struct({ code: Schema.Literal("integration-referenced"), pluginSlug: PluginSlug }),
	Schema.Struct({
		pluginSlug: PluginSlug,
		code: Schema.Literal("installation-not-ready"),
		health: Schema.Literals(["failed", "installing", "incompatible", "needs-configuration"]),
	}),
	Schema.Struct({
		pluginSlug: PluginSlug,
		code: Schema.Literal("definition-referenced"),
		diagnostics: Schema.Array(PluginValidationDiagnostic),
	}),
]);

const PluginNotFoundReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("plugin-not-found"), pluginSlug: PluginSlug }),
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
	Schema.Struct({
		pluginSlug: PluginSlug,
		operationSlug: Schema.String,
		code: Schema.Literal("script-unavailable"),
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

export const PluginPackage = Schema.Struct({
	manifest: PluginManifest,
	files: Schema.Record(Schema.String, Schema.String),
});

export type PluginPackage = Schema.Schema.Type<typeof PluginPackage>;

export const InstallPluginBody = Schema.Struct({
	...PluginPackage.fields,
	config: Schema.Record(Schema.String, Schema.Unknown),
});

export type InstallPluginBody = Schema.Schema.Type<typeof InstallPluginBody>;

export const UpdatePrivatePluginBody = strictStruct({
	...PluginPackage.fields,
	unsetConfigKeys: Schema.optional(Schema.Array(Schema.String)),
	config: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

export type UpdatePrivatePluginBody = typeof UpdatePrivatePluginBody.Type;

export const UpdatePluginInstallationBody = strictStruct({
	isDisabled: Schema.optional(Schema.Boolean),
	unsetConfigKeys: Schema.optional(Schema.Array(Schema.String)),
	config: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
	sortOrder: Schema.optional(
		Schema.Int.pipe(
			Schema.check(Schema.isBetween({ minimum: -2_147_483_648, maximum: 2_147_483_647 })),
		),
	),
});

export type UpdatePluginInstallationBody = typeof UpdatePluginInstallationBody.Type;

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
	configuredSecrets: Schema.Array(Schema.String),
	config: Schema.Record(Schema.String, Schema.Unknown),
});

export type PluginInstallationItem = Schema.Schema.Type<typeof PluginInstallationItem>;

export const PluginInstallationList = Schema.Array(PluginInstallationItem);

export const PluginInvokeBody = Schema.Struct({ payload: Schema.Unknown });

export type PluginInvokeBody = Schema.Schema.Type<typeof PluginInvokeBody>;

export const PluginInvokeResult = Schema.Struct({ result: Schema.Unknown });

export type PluginInvokeResult = Schema.Schema.Type<typeof PluginInvokeResult>;
