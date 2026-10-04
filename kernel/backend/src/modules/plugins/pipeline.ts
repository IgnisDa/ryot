import {
	clientArtifactMetadata,
	clientDeclarationHash,
	PluginClientArtifact,
	isPluginClientArtifactContentType,
} from "@ryot-app/client-plugin-contract";
import type { BadRequest, DbError } from "@ryot-app/contract/errors";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	PluginRequestError,
	type PluginConflictError,
} from "@ryot-app/contract/modules/plugins/schemas";
import type { UploadBadRequest } from "@ryot-app/contract/modules/uploads/schemas";
import {
	PLUGIN_ARCHIVE_LIMITS,
	type PluginArchiveCompiledScript,
	type PluginArchiveError,
} from "@ryot-app/plugin-archive";
import { declaredScriptMetadata } from "@ryot-app/sandbox-compiler/plugin-manifest";
import { SANDBOX_RUNTIME_EXTERNAL_SPECIFIERS } from "@ryot-app/sandbox-sdk/imports";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { decodeExecutableText, encodeExecutableText } from "@ryot-app/ts-utils/executable-text";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { auditSandboxEsmOutput } from "@ryot-app/vite-compiler";
import { Effect, Match, Result, Schema } from "effect";

import type { SchemaEvolutionError } from "./schema-evolution";
import type {
	NormalizedPlugin,
	NormalizedPluginScript,
	PluginScriptDescriptor,
	PluginSource,
} from "./types";
import {
	decodePluginManifest,
	type PluginPackageReservedError,
	type PluginSurfaceError,
	PluginValidationError,
	validateImportSourceInputSchemas,
	validateIntegrationProviderSettingsSchemas,
} from "./validation";

export const digest = sha256Hex;

const compareCodeUnits = (left: string, right: string) => {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
};
const approvedRuntimeImports = new Set<string>(SANDBOX_RUNTIME_EXTERNAL_SPECIFIERS);

export const toPluginScriptDescriptor = (
	script: NormalizedPluginScript,
): PluginScriptDescriptor => ({
	slug: script.slug,
	name: script.name,
	entry: script.entry,
	metadata: script.metadata,
	contentHash: script.contentHash,
});

export const pluginSourceHash = (
	manifest: PluginManifest,
	compiledScripts: ReadonlyArray<PluginArchiveCompiledScript> = [],
	compiledClient?: PluginClientArtifact,
) =>
	digest(
		stableStringify({
			manifest,
			compiledScripts: compiledScripts
				.slice()
				.sort((left, right) => compareCodeUnits(left.entry, right.entry))
				.map(({ entry, format, javascript }) => ({
					entry,
					format,
					javascriptHash: digest(javascript),
				})),
			compiledClient: compiledClient
				? {
						hash: compiledClient.hash,
						format: compiledClient.format,
						apiVersion: compiledClient.apiVersion,
						bridgeVersion: compiledClient.bridgeVersion,
						compilerVersion: compiledClient.compilerVersion,
						files: compiledClient.files
							.slice()
							.sort((left, right) => compareCodeUnits(left.name, right.name))
							.map(({ name, contents, contentType }) => ({
								name,
								contentType,
								sha256: digest(contents),
							})),
					}
				: null,
		}),
	);

export const verifyPluginClientArtifact = (
	manifest: PluginManifest,
	artifact: PluginClientArtifact,
) => {
	if (!manifest.client) {
		return false;
	}
	const declarationHash = clientDeclarationHash(manifest.client);
	const dependencies = Object.values(manifest.client.pluginDependencies ?? {});
	return (
		artifact.packageId === manifest.metadata.packageId &&
		artifact.clientDeclarationHash === declarationHash &&
		artifact.imports.every(({ reference }) =>
			dependencies.some(
				(dependency) =>
					dependency.packageId === reference.packageId && dependency.scope === reference.scope,
			),
		) &&
		clientArtifactMetadata(manifest.metadata.name, manifest.metadata.packageId, artifact.files, {
			imports: artifact.imports,
			clientDeclarationHash: declarationHash,
		}).hash === artifact.hash
	);
};

export const normalizePluginSource = Effect.fn("PluginPipeline.normalizePluginSource")(function* (
	source: PluginSource,
) {
	const manifest = yield* decodePluginManifest(source.manifest);
	yield* validateIntegrationProviderSettingsSchemas(manifest);
	yield* validateImportSourceInputSchemas(manifest);
	if (!Array.isArray(source.compiledScripts)) {
		return yield* new PluginValidationError({ issues: ["Plugin compiled scripts are missing"] });
	}
	const compiledByEntry = new Map(source.compiledScripts.map((script) => [script.entry, script]));
	const scripts = manifest.scripts.flatMap((declared) => {
		const compiled = compiledByEntry.get(declared.entry);
		return compiled === undefined ? [] : [{ declared, compiled }];
	});
	if (
		new Set(manifest.scripts.map(({ entry }) => entry)).size !== manifest.scripts.length ||
		compiledByEntry.size !== source.compiledScripts.length ||
		scripts.length !== manifest.scripts.length ||
		scripts.length !== source.compiledScripts.length
	) {
		return yield* new PluginValidationError({
			issues: ["Plugin compiled scripts must exactly match manifest script entries"],
		});
	}
	for (const { declared, compiled: script } of scripts) {
		if (script.format !== 1) {
			return yield* new PluginValidationError({
				issues: [`Plugin compiled script is invalid: ${script.entry}`],
			});
		}
		yield* Effect.try({
			try: () => encodeExecutableText(script.javascript),
			catch: () =>
				new PluginValidationError({
					issues: [`Plugin compiled script JavaScript is not valid UTF-8: ${script.entry}`],
				}),
		});
		const audit = auditSandboxEsmOutput(script.javascript, approvedRuntimeImports);
		if (Result.isFailure(audit)) {
			return yield* new PluginValidationError({
				issues: [
					`Plugin compiled script output is invalid: ${script.entry}: ${audit.failure.message}`,
				],
			});
		}
		if (
			audit.success.length !== declared.runtimeImports.length ||
			audit.success.some((specifier, index) => specifier !== declared.runtimeImports[index])
		) {
			return yield* new PluginValidationError({
				issues: [
					`Plugin compiled script runtime imports do not match its manifest: ${script.entry}`,
				],
			});
		}
	}
	if (Boolean(manifest.client) !== Boolean(source.compiledClient)) {
		return yield* new PluginValidationError({
			issues: [
				manifest.client
					? "Plugin client manifest is missing its compiled client artifact"
					: "Plugin has a compiled client artifact without a client manifest",
			],
		});
	}
	let compiledClient: PluginClientArtifact | undefined;
	if (source.compiledClient) {
		const client = manifest.client;
		if (!client) {
			return yield* new PluginValidationError({
				issues: ["Plugin client artifact has no client declaration"],
			});
		}
		compiledClient = yield* Schema.decodeEffect(PluginClientArtifact)(source.compiledClient).pipe(
			Effect.mapError(
				() => new PluginValidationError({ issues: ["Plugin compiled client artifact is invalid"] }),
			),
		);
		if (
			compiledClient.packageId !== manifest.metadata.packageId ||
			compiledClient.clientDeclarationHash !== clientDeclarationHash(client) ||
			compiledClient.files.length > PLUGIN_ARCHIVE_LIMITS.maxCompiledClientFiles
		) {
			return yield* new PluginValidationError({
				issues: ["Plugin compiled client artifact does not match the client manifest"],
			});
		}
		let artifactBytes = 0;
		for (const file of compiledClient.files) {
			artifactBytes += file.contents.byteLength;
			if (
				canonicalRelativePosixPathIssue(file.name) !== null ||
				!isPluginClientArtifactContentType(file.contentType) ||
				artifactBytes > PLUGIN_ARCHIVE_LIMITS.maxCompiledClientBytes
			) {
				return yield* new PluginValidationError({
					issues: [`Plugin compiled client artifact file is invalid: ${file.name}`],
				});
			}
			if (file.contentType.startsWith("text/javascript")) {
				yield* Effect.try({
					try: () => decodeExecutableText(file.contents),
					catch: () =>
						new PluginValidationError({
							issues: [`Plugin compiled client artifact file is invalid: ${file.name}`],
						}),
				});
			}
		}
		if (!verifyPluginClientArtifact(manifest, compiledClient)) {
			return yield* new PluginValidationError({
				issues: ["Plugin compiled client artifact content hash is invalid"],
			});
		}
	}
	const sourceHash = pluginSourceHash(manifest, source.compiledScripts, compiledClient);
	return {
		scripts,
		manifest,
		compiledScripts: source.compiledScripts,
		...(compiledClient ? { compiledClient } : {}),
		sourceHash,
	};
});

export const normalizePluginPackage = (
	input: Effect.Success<ReturnType<typeof normalizePluginSource>>,
) =>
	({
		manifest: input.manifest,
		sourceHash: input.sourceHash,
		...(input.compiledClient ? { compiledClient: input.compiledClient } : {}),
		scripts: input.scripts.map(({ declared, compiled }): NormalizedPluginScript => ({
			slug: declared.slug,
			name: declared.name,
			entry: declared.entry,
			compiledFormat: compiled.format,
			compiledCode: compiled.javascript,
			contentHash: digest(compiled.javascript),
			metadata: declaredScriptMetadata(declared),
		})),
	}) satisfies NormalizedPlugin;

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
	| PluginRequestError
	| SchemaEvolutionError
	| PluginValidationError
	| PluginPackageReservedError;

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
						reason: { issue: error.reason, code: "package-archive-invalid" },
					}),
				),
			PluginSurfaceError: (error: PluginSurfaceError) =>
				Effect.fail(
					new PluginRequestError({
						reason: { surfaces: error.surfaces, code: "unsupported-manifest-surface" },
					}),
				),
			PluginValidationError: (error: PluginValidationError) =>
				Effect.fail(
					new PluginRequestError({
						reason: { code: "validation-failed", diagnostics: validationDiagnostics(error) },
					}),
				),
			PluginPackageReservedError: (error: PluginPackageReservedError) =>
				Effect.fail(
					new PluginRequestError({
						reason: { packageId: error.packageId, code: "reserved-system-identity" },
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
		}),
	);
