import type { PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	pluginPackageKey,
	type PluginPackageReference,
} from "@ryot-app/contract/modules/plugins/references";
import { pluginIdentityReferences } from "@ryot-app/contract/modules/ryotql/authored";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "@ryot-app/plugin-client-compiler/limits";
import {
	ClientArtifact,
	isPluginClientArtifactContentType,
	PageClientArtifact,
	pageClientArtifactMetadata,
	pageDeclarationHash,
} from "@ryot-app/plugin-client-contract";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { decodeExecutableText } from "@ryot-app/ts-utils/executable-text";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { Effect, Schema, Stream } from "effect";

import { preparePageDefinition } from "#modules/pages/authoring/definition";

import type { ValidatedArchiveBinary } from "./archive/archive";
import { archiveError } from "./archive/error";
import { exportQueryPluginReferences, importQueryPluginReferences } from "./archive/references";
import type { ArchiveClientArtifact, ArchivePageArtifact } from "./archive/schemas";

export const exportPageDefinition = Effect.fn(function* (
	definition: PageDefinition,
	packages: ReadonlyMap<string, PluginPackageReference>,
) {
	const queries = yield* exportQueryPluginReferences(definition.queries, packages);
	if (queries === null) {
		return yield* archiveError("invalid_entry", "Page queries are missing");
	}
	return { ...definition, queries };
});

export const importPageDefinition = Effect.fn(function* (
	definition: PageDefinition,
	plugins: ReadonlyMap<string, string>,
) {
	const queries = yield* importQueryPluginReferences(definition.queries, plugins);
	if (queries === null) {
		return yield* archiveError("invalid_entry", "Page queries are missing");
	}
	return yield* preparePageDefinition({ ...definition, queries }).pipe(
		Effect.mapError((error) => archiveError("invalid_entry", error.message, "pages.ndjson")),
	);
});

export const pagePluginKeys = (definition: PageDefinition) =>
	new Set([
		...Object.values(definition.pluginDependencies).map(pluginPackageKey),
		...pluginIdentityReferences(definition.queries).flatMap((reference) =>
			reference.kind === "package" ? [pluginPackageKey(reference)] : [],
		),
	]);

export const describeClientArtifact = (artifact: ClientArtifact): ArchiveClientArtifact => ({
	...artifact,
	files: artifact.files.map(({ name, contents, contentType }) => ({
		name,
		contentType,
		size: contents.byteLength,
		sha256: sha256Hex(contents),
	})),
});

export const describePageArtifact = (artifact: PageClientArtifact): ArchivePageArtifact => ({
	...artifact,
	files: describeClientArtifact(artifact).files,
});

const validateClientArtifactFiles = Effect.fn(function* (files: ClientArtifact["files"]) {
	let size = 0;
	for (const file of files) {
		size += file.contents.byteLength;
		if (
			canonicalRelativePosixPathIssue(file.name) !== null ||
			!isPluginClientArtifactContentType(file.contentType)
		) {
			return yield* archiveError("invalid_entry", "Invalid client artifact file", "pages.ndjson");
		}
		if (file.contentType.startsWith("text/javascript")) {
			yield* Effect.try({
				try: () => decodeExecutableText(file.contents),
				catch: () => archiveError("invalid_entry", "Invalid client JavaScript", "pages.ndjson"),
			});
		}
	}
	return size;
});

export const validatePageArtifact = Effect.fn(function* (
	value: unknown,
	definition: PageDefinition,
) {
	const artifact = yield* Schema.decodeUnknownEffect(PageClientArtifact)(value).pipe(
		Effect.mapError((error) => archiveError("invalid_entry", error.message, "pages.ndjson")),
	);
	const declarations = new Set(Object.values(definition.pluginDependencies).map(pluginPackageKey));
	const size = yield* validateClientArtifactFiles(artifact.files);
	if (
		size > CLIENT_PLUGIN_COMPILER_LIMITS.artifactBytes ||
		artifact.files.length > CLIENT_PLUGIN_COMPILER_LIMITS.artifactFileCount ||
		artifact.pageDeclarationHash !== pageDeclarationHash(definition) ||
		artifact.hash !== pageClientArtifactMetadata("page", artifact.files, artifact).hash ||
		!artifact.files.some(
			({ name, contentType }) =>
				name === "module.js" && contentType === "text/javascript; charset=utf-8",
		) ||
		artifact.imports.some(({ reference }) => !declarations.has(pluginPackageKey(reference)))
	) {
		return yield* archiveError(
			"invalid_entry",
			"Page artifact identity is invalid",
			"pages.ndjson",
		);
	}
	return artifact;
});

const readClientArtifactFiles = Effect.fn(function* (
	metadata: ArchiveClientArtifact,
	blobs: ReadonlyMap<string, ValidatedArchiveBinary>,
) {
	let size = 0;
	if (metadata.files.length > CLIENT_PLUGIN_COMPILER_LIMITS.artifactFileCount) {
		return yield* archiveError("invalid_entry", "Too many page artifact files", "pages.ndjson");
	}
	const files = [];
	for (const file of metadata.files) {
		size += file.size;
		const blob = blobs.get(file.sha256);
		if (!blob || blob.size !== file.size || size > CLIENT_PLUGIN_COMPILER_LIMITS.artifactBytes) {
			return yield* archiveError(
				"invalid_entry",
				"Page artifact binary is missing or invalid",
				"pages.ndjson",
			);
		}
		const contents = new Uint8Array(file.size);
		let offset = 0;
		yield* Stream.runForEach(blob.stream, (chunk) =>
			Effect.gen(function* () {
				if (offset + chunk.byteLength > contents.byteLength) {
					return yield* archiveError("checksum_mismatch", "Page binary size mismatch", blob.path);
				}
				contents.set(chunk, offset);
				offset += chunk.byteLength;
				return yield* Effect.void;
			}),
		);
		if (offset !== file.size || sha256Hex(contents) !== file.sha256) {
			return yield* archiveError(
				"checksum_mismatch",
				"Page artifact binary checksum mismatch",
				blob.path,
			);
		}
		files.push({ contents, name: file.name, contentType: file.contentType });
	}
	return files;
});

export const readClientArtifact = Effect.fn(function* (
	metadata: ArchiveClientArtifact,
	blobs: ReadonlyMap<string, ValidatedArchiveBinary>,
) {
	const files = yield* readClientArtifactFiles(metadata, blobs);
	yield* validateClientArtifactFiles(files);
	return yield* Schema.decodeEffect(ClientArtifact)({ ...metadata, files }).pipe(
		Effect.mapError((error) => archiveError("invalid_entry", error.message)),
	);
});

export const readPageArtifact = Effect.fn(function* (
	metadata: ArchivePageArtifact,
	definition: PageDefinition,
	blobs: ReadonlyMap<string, ValidatedArchiveBinary>,
) {
	return yield* validatePageArtifact(
		{ ...metadata, files: yield* readClientArtifactFiles(metadata, blobs) },
		definition,
	);
});

export const validatePageArtifactImports = Effect.fn(function* (
	artifact: ArchivePageArtifact,
	clients: ReadonlyMap<string, PluginManifest["client"]>,
) {
	for (const target of artifact.imports) {
		if (!clients.get(pluginPackageKey(target.reference))?.exports?.[target.exportName]) {
			return yield* archiveError(
				"invalid_entry",
				"Page artifact imports an unavailable export",
				"pages.ndjson",
			);
		}
	}
	return yield* Effect.void;
});
