import {
	clientArtifactMetadata,
	PluginClientArtifact as PluginClientArtifactSchema,
	isPluginClientArtifactContentType,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import type { BadRequest, DbError } from "@ryot-app/contract/errors";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	PluginRequestError,
	type PluginConflictError,
} from "@ryot-app/contract/modules/plugins/schemas";
import type { UploadBadRequest } from "@ryot-app/contract/modules/uploads/schemas";
import { PluginSlug } from "@ryot-app/contract/schema/brands";
import {
	PLUGIN_ARCHIVE_LIMITS,
	type PluginArchiveCompiledScript,
	type PluginArchiveError,
} from "@ryot-app/plugin-archive";
import { declaredScriptMetadata } from "@ryot-app/sandbox-compiler/plugin-manifest";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { decodeExecutableText, encodeExecutableText } from "@ryot-app/ts-utils/executable-text";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { Effect, Match, Schema } from "effect";

import type { SchemaEvolutionError } from "./schema-evolution";
import type {
	NormalizedPlugin,
	NormalizedPluginScript,
	PluginScriptDescriptor,
	PluginSource,
} from "./types";
import {
	decodePluginManifest,
	type PluginSlugReservedError,
	type PluginSurfaceError,
	PluginValidationError,
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

export const normalizePluginSource = Effect.fn("PluginPipeline.normalizePluginSource")(function* (
	source: PluginSource,
) {
	const manifest = yield* decodePluginManifest(source.manifest);
	if (!Array.isArray(source.compiledScripts)) {
		return yield* new PluginValidationError({ issues: ["Plugin compiled scripts are missing"] });
	}
	const expectedEntries = new Set(manifest.scripts.map(({ entry }) => entry));
	const compiledByEntry = new Map(source.compiledScripts.map((script) => [script.entry, script]));
	if (
		expectedEntries.size !== manifest.scripts.length ||
		compiledByEntry.size !== source.compiledScripts.length ||
		compiledByEntry.size !== expectedEntries.size ||
		[...expectedEntries].some((entry) => !compiledByEntry.has(entry))
	) {
		return yield* new PluginValidationError({
			issues: ["Plugin compiled scripts must exactly match manifest script entries"],
		});
	}
	for (const script of source.compiledScripts) {
		if (!Number.isSafeInteger(script.format) || script.format < 1) {
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
		compiledClient = yield* Schema.decodeEffect(PluginClientArtifactSchema)(
			source.compiledClient,
		).pipe(
			Effect.mapError(
				() => new PluginValidationError({ issues: ["Plugin compiled client artifact is invalid"] }),
			),
		);
		if (
			compiledClient.apiVersion !== manifest.client?.apiVersion ||
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
		if (
			compiledClient.hash !==
			clientArtifactMetadata(manifest.metadata.name, compiledClient.files).hash
		) {
			return yield* new PluginValidationError({
				issues: ["Plugin compiled client artifact content hash is invalid"],
			});
		}
	}
	const sourceHash = pluginSourceHash(manifest, source.compiledScripts, compiledClient);
	return {
		manifest,
		compiledScripts: source.compiledScripts,
		...(compiledClient ? { compiledClient } : {}),
		sourceHash,
	};
});

export const normalizePluginPackage = Effect.fn("PluginPipeline.normalizePluginPackage")(
	(input: Effect.Success<ReturnType<typeof normalizePluginSource>>) =>
		Effect.gen(function* () {
			const compiledByEntry = new Map(
				input.compiledScripts.map((script) => [script.entry, script]),
			);
			const scripts: Array<NormalizedPluginScript> = yield* Effect.forEach(
				input.manifest.scripts,
				(script) => {
					const compiled = compiledByEntry.get(script.entry);
					if (!compiled) {
						return Effect.fail(
							new PluginValidationError({
								issues: [`Normalized plugin is missing compiled script ${script.entry}`],
							}),
						);
					}
					return Effect.succeed({
						slug: script.slug,
						name: script.name,
						entry: script.entry,
						compiledFormat: compiled.format,
						compiledCode: compiled.javascript,
						contentHash: digest(compiled.javascript),
						metadata: declaredScriptMetadata(script),
					});
				},
			);
			return {
				scripts,
				manifest: input.manifest,
				sourceHash: input.sourceHash,
				...(input.compiledClient ? { compiledClient: input.compiledClient } : {}),
			} satisfies NormalizedPlugin;
		}),
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
	| PluginSlugReservedError;

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
		}),
	);
