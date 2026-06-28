import type { ClientPluginCompilerFailure } from "@ryot/client-plugin-compiler/diagnostics";
import type { BadRequest, DbError } from "@ryot/contract/errors";
import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import {
	PluginRequestError,
	type PluginConflictError,
} from "@ryot/contract/modules/plugins/schemas";
import type { UploadBadRequest } from "@ryot/contract/modules/uploads/schemas";
import { PluginSlug } from "@ryot/contract/schema/brands";
import type { PluginArchiveError } from "@ryot/plugin-archive";
import type { SandboxCompilerFailure } from "@ryot/sandbox-compiler/diagnostics";
import { compilePluginSandboxSourceEntries } from "@ryot/sandbox-compiler/plugins";
import { sha256Hex } from "@ryot/ts-utils/crypto";
import { stableStringify } from "@ryot/ts-utils/json";
import { Effect, Match } from "effect";

import { ClientPluginCompiler } from "#modules/plugins/client-plugin-compiler";

import type { SchemaEvolutionError } from "./schema-evolution";
import type { NormalizedPlugin, PluginScriptMetadata } from "./types";
import type {
	PluginPackageLimitError,
	PluginSlugReservedError,
	PluginSurfaceError,
} from "./validation";
import { PluginValidationError } from "./validation";

export const digest = sha256Hex;

export const pluginSourceHash = (
	manifest: PluginManifest,
	files: Readonly<Record<string, string>>,
) => digest(stableStringify({ files, manifest }));

export const declaredScriptMetadata = (
	script: PluginManifest["scripts"][number],
): PluginScriptMetadata => {
	if (script.kind === "script") {
		return {
			slug: script.slug,
			name: script.name,
			kind: script.kind,
			capabilities: script.capabilities,
			requiredPluginConfigKeys: script.requiredPluginConfigKeys,
			requiredSystemConfigKeys: script.requiredSystemConfigKeys,
			...(script.providerSlug ? { providerSlug: script.providerSlug } : {}),
		};
	}
	if (script.kind === "operation" || script.kind === "automation") {
		return {
			slug: script.slug,
			name: script.name,
			kind: script.kind,
			capabilities: script.capabilities,
			requiredPluginConfigKeys: script.requiredPluginConfigKeys,
			requiredSystemConfigKeys: script.requiredSystemConfigKeys,
		};
	}
	if (script.kind === "workflow") {
		return {
			kind: "workflow",
			slug: script.slug,
			name: script.name,
			capabilities: script.capabilities,
			requiredPluginConfigKeys: script.requiredPluginConfigKeys,
			requiredSystemConfigKeys: script.requiredSystemConfigKeys,
		};
	}
	return {
		kind: "provider",
		slug: script.slug,
		name: script.name,
		capabilities: script.capabilities,
		providerSlug: script.providerSlug,
		providerOperation: script.providerOperation,
		requiredPluginConfigKeys: script.requiredPluginConfigKeys,
		requiredSystemConfigKeys: script.requiredSystemConfigKeys,
		...("searchOptionsSchema" in script && script.searchOptionsSchema
			? { searchOptionsSchema: script.searchOptionsSchema }
			: {}),
	};
};

const compiledScriptMetadata = (script: PluginManifest["scripts"][number]) => {
	if (script.kind === "script") {
		const { entry: _entry, providerSlug: _providerSlug, ...compiledMetadata } = script;
		return compiledMetadata;
	}
	if (script.kind !== "provider") {
		return declaredScriptMetadata(script);
	}
	const {
		entry: _entry,
		providerSlug: _providerSlug,
		providerOperation: _providerOperation,
		...compiledMetadata
	} = script;
	return compiledMetadata;
};

export const compilePluginPackage = Effect.fn("PluginPipeline.compilePluginPackage")(
	function* (input: {
		readonly sourceHash: string;
		readonly manifest: PluginManifest;
		readonly files: Readonly<Record<string, string>>;
	}) {
		const compilerScripts = input.manifest.scripts.map((script) => {
			if (script.kind === "script") {
				const { providerSlug, ...genericScript } = script;
				return providerSlug ? { ...genericScript, providerSlug } : genericScript;
			}
			return script;
		});
		const compiled = yield* compilePluginSandboxSourceEntries(input.files, compilerScripts).pipe(
			Effect.tapError((error) => Effect.logError("plugin compile error", error)),
		);
		const compiledByEntry = new Map(compiled.map((script) => [script.entry, script]));
		const scripts = yield* Effect.forEach(input.manifest.scripts, (script) => {
			const output = compiledByEntry.get(script.entry);
			if (!output) {
				return Effect.fail(
					new PluginValidationError({
						issues: [`Compiler returned no output for ${script.entry}`],
					}),
				);
			}
			if (
				stableStringify(compiledScriptMetadata(script)) !==
				stableStringify(output.compiled.manifest)
			) {
				return Effect.fail(
					new PluginValidationError({
						issues: [`Declared script metadata does not match ${script.entry}`],
					}),
				);
			}
			return Effect.succeed({
				slug: script.slug,
				name: script.name,
				entry: script.entry,
				source: output.source,
				compiledFormat: output.compiled.format,
				compiledCode: output.compiled.javascript,
				metadata: declaredScriptMetadata(script),
				contentHash: digest(output.compiled.javascript),
			});
		});
		const clientCompiler = yield* ClientPluginCompiler;
		const clientEntry = input.manifest.client;
		const clientArtifact = clientEntry
			? yield* clientCompiler
					.compile({
						files: input.files,
						entry: clientEntry.entry,
						apiVersion: clientEntry.apiVersion,
					})
					.pipe(Effect.tapError((error) => Effect.logError("plugin client compile error", error)))
			: null;
		return {
			scripts,
			clientArtifact,
			manifest: input.manifest,
			sourceFiles: input.files,
			sourceHash: input.sourceHash,
			clientArtifactHash: clientArtifact ? clientArtifact.hash : null,
		} satisfies NormalizedPlugin;
	},
);

export const validationDiagnostics = (error: PluginValidationError) =>
	error.issues.map((message) => ({
		message,
		phase: "validate" as const,
		severity: "error" as const,
		code: "plugin-validation-error",
	}));

const schemaEvolutionCode = (code: SchemaEvolutionError["issues"][number]["code"]) =>
	Match.value(code).pipe(
		Match.when("enum_narrowed", () => "enum-narrowed" as const),
		Match.when("schema_changed", () => "schema-changed" as const),
		Match.when("schema_removed", () => "schema-removed" as const),
		Match.when("property_changed", () => "property-changed" as const),
		Match.when("property_removed", () => "property-removed" as const),
		Match.when("property_type_changed", () => "property-type-changed" as const),
		Match.when("required_property_added", () => "required-property-added" as const),
		Match.exhaustive,
	);

type StructurablePluginFailure =
	| DbError
	| BadRequest
	| UploadBadRequest
	| PluginArchiveError
	| PluginSurfaceError
	| PluginConflictError
	| SchemaEvolutionError
	| PluginValidationError
	| SandboxCompilerFailure
	| PluginPackageLimitError
	| PluginSlugReservedError
	| ClientPluginCompilerFailure;

export const structurePluginFailure = <A, R>(
	effect: Effect.Effect<A, StructurablePluginFailure, R>,
) =>
	effect.pipe(
		Effect.catchTags({
			BadRequest: () =>
				Effect.fail(new PluginRequestError({ reason: { code: "upload-unavailable" } })),
			UploadBadRequest: () =>
				Effect.fail(new PluginRequestError({ reason: { code: "upload-unavailable" } })),
			PluginArchiveError: (error: PluginArchiveError) =>
				Effect.fail(
					new PluginRequestError({
						reason: { code: "package-archive-invalid", issue: error.reason },
					}),
				),
			PluginSurfaceError: (error: PluginSurfaceError) =>
				Effect.fail(
					new PluginRequestError({
						reason: { code: "unsupported-manifest-surface", surfaces: error.surfaces },
					}),
				),
			PluginPackageLimitError: (error: PluginPackageLimitError) =>
				Effect.fail(
					new PluginRequestError({
						reason: { code: "package-limit-exceeded", limit: error.limit },
					}),
				),
			PluginSlugReservedError: (error: PluginSlugReservedError) =>
				Effect.fail(
					new PluginRequestError({
						reason: { code: "slug-reserved", pluginSlug: PluginSlug.make(error.pluginSlug) },
					}),
				),
			SchemaEvolutionError: (error: SchemaEvolutionError) =>
				Effect.fail(
					new PluginRequestError({
						reason: {
							code: "schema-evolution-failed",
							issues: error.issues.map(({ code, path }) => ({
								path,
								code: schemaEvolutionCode(code),
							})),
						},
					}),
				),
			PluginValidationError: (error: PluginValidationError) =>
				Effect.fail(
					new PluginRequestError({
						reason: { code: "validation-failed", diagnostics: validationDiagnostics(error) },
					}),
				),
			SandboxCompilerFailure: (error: SandboxCompilerFailure) =>
				Effect.fail(
					new PluginRequestError({
						reason: {
							code: "compilation-failed",
							diagnostics: error.diagnostics.map((diagnostic) => ({
								...diagnostic,
								phase: "compile" as const,
							})),
						},
					}),
				),
			ClientPluginCompilerFailure: (error: ClientPluginCompilerFailure) =>
				Effect.fail(
					new PluginRequestError({
						reason: {
							code: "compilation-failed",
							diagnostics: error.diagnostics.map((diagnostic) => ({
								...diagnostic,
								phase: "compile" as const,
							})),
						},
					}),
				),
		}),
	);
