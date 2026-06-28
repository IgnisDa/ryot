import type { ClientPluginCompilerFailure } from "@ryot-app/client-plugin-compiler/diagnostics";
import type { BadRequest, DbError } from "@ryot-app/contract/errors";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	PluginRequestError,
	type PluginConflictError,
} from "@ryot-app/contract/modules/plugins/schemas";
import type { UploadBadRequest } from "@ryot-app/contract/modules/uploads/schemas";
import { PluginSlug } from "@ryot-app/contract/schema/brands";
import type { PluginArchiveError } from "@ryot-app/plugin-archive";
import type { SandboxCompilerFailure } from "@ryot-app/sandbox-compiler/diagnostics";
import {
	compilePluginManifestScripts,
	declaredScriptMetadata,
	pluginScriptCompileMismatchIssue,
} from "@ryot-app/sandbox-compiler/plugin-manifest";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect, Match } from "effect";

import { ClientPluginCompiler } from "#modules/plugins/client-plugin-compiler";

import type { SchemaEvolutionError } from "./schema-evolution";
import type { NormalizedPlugin, PluginSource } from "./types";
import {
	decodePluginManifest,
	type PluginPackageLimitError,
	type PluginSlugReservedError,
	type PluginSurfaceError,
	PluginValidationError,
} from "./validation";

export const digest = sha256Hex;

export const pluginSourceHash = (
	manifest: PluginManifest,
	files: Readonly<Record<string, Uint8Array>>,
) =>
	digest(
		stableStringify({
			manifest,
			files: sortBy(Object.entries(files), ([path]) => path).map(([path, contents]) => [
				path,
				digest(contents),
			]),
		}),
	);

export const decodePluginBackendFiles = (files: Readonly<Record<string, Uint8Array>>) =>
	Effect.try({
		try: () =>
			Object.fromEntries(
				Object.entries(files)
					.filter(([path]) => !path.startsWith("client/"))
					.map(([path, contents]) => [
						path,
						new TextDecoder("utf-8", { fatal: true }).decode(contents),
					]),
			),
		catch: () =>
			new PluginValidationError({ issues: ["Plugin backend source is not valid UTF-8"] }),
	});

export const normalizePluginSource = Effect.fn("PluginPipeline.normalizePluginSource")(function* (
	source: PluginSource,
) {
	const manifest = yield* decodePluginManifest(source.manifest);
	return { manifest, files: source.files, sourceHash: pluginSourceHash(manifest, source.files) };
});

export const compilePluginPackage = Effect.fn("PluginPipeline.compilePluginPackage")(
	function* (input: {
		readonly sourceHash: string;
		readonly manifest: PluginManifest;
		readonly files: Readonly<Record<string, Uint8Array>>;
	}) {
		const backendFiles = yield* decodePluginBackendFiles(input.files);
		const compiled = yield* compilePluginManifestScripts(input.manifest, backendFiles).pipe(
			Effect.tapError((error) => Effect.logError("plugin compile error", error)),
			Effect.catchTag("PluginScriptCompileMismatch", (error) =>
				Effect.fail(
					new PluginValidationError({ issues: [pluginScriptCompileMismatchIssue(error)] }),
				),
			),
		);
		const scripts = compiled.map(({ script, source, compiled: output }) => ({
			source,
			slug: script.slug,
			name: script.name,
			entry: script.entry,
			compiledFormat: output.format,
			compiledCode: output.javascript,
			metadata: declaredScriptMetadata(script),
			contentHash: digest(output.javascript),
		}));
		const clientCompiler = yield* ClientPluginCompiler;
		const clientEntry = input.manifest.client;
		if (clientEntry) {
			yield* clientCompiler
				.compile({
					files: input.files,
					name: input.manifest.metadata.name,
					apiVersion: clientEntry.apiVersion,
					pluginDependencies: clientEntry.pluginDependencies ?? [],
					publicExports: Object.fromEntries(
						Object.entries(clientEntry.exports ?? {}).map(([name, declaration]) => [
							name,
							{ entry: declaration.entry, kind: declaration.kind },
						]),
					),
				})
				.pipe(Effect.tapError((error) => Effect.logError("plugin client compile error", error)));
		}
		return {
			scripts,
			files: input.files,
			manifest: input.manifest,
			sourceHash: input.sourceHash,
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
