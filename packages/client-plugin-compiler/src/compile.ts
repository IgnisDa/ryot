import type {
	CLIENT_API_VERSION,
	PluginClientArtifact,
	PluginClientArtifactFile,
} from "@ryot/contract/modules/plugins/client";
import {
	isPluginClientTextSource,
	pluginClientAssetMimeType,
} from "@ryot/contract/modules/plugins/client";
import { sortBy } from "@ryot/ts-utils/lodash";
import { Effect } from "effect";

import {
	CLIENT_ARTIFACT_DOCUMENT_NAME,
	CLIENT_ARTIFACT_SCRIPT_NAME,
	CLIENT_ARTIFACT_STYLE_NAME,
	clientArtifactDocument,
	clientArtifactMetadata,
	clientAssetArtifactFile,
	clientAssetName,
	clientGeneratedArtifactFile,
} from "./artifact";
import { bundleClientPlugin } from "./bundle";
import { resolveClientPluginCompilerDependencies } from "./dependencies";
import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "./limits";
import { compileClientStyles } from "./styles";

const CLIENT_SOURCE_ROOT = "client/";
const SCANNED_EXTENSIONS = new Set(["ts", "tsx"]);

export type ClientPluginCompilerInput = {
	readonly entry: string;
	readonly apiVersion: typeof CLIENT_API_VERSION;
	readonly files: Readonly<Record<string, Uint8Array>>;
};

const extensionOf = (path: string) => path.slice(path.lastIndexOf(".") + 1);

const failure = (entry: string, code: string, message: string) =>
	clientPluginCompilationFailure([clientPluginCompilerDiagnostic(code, entry, message)]);

const duplicateFileName = (files: readonly PluginClientArtifactFile[]) => {
	const names = new Set<string>();
	return files.find(({ name }) => {
		if (names.has(name)) {
			return true;
		}
		names.add(name);
		return false;
	})?.name;
};

const bytesEqual = (left: Uint8Array, right: Uint8Array) =>
	left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

export const compileClientPlugin = ({ entry, files }: ClientPluginCompilerInput) =>
	Effect.gen(function* () {
		if (
			(!entry.endsWith(".ts") && !entry.endsWith(".tsx")) ||
			!entry.startsWith(CLIENT_SOURCE_ROOT) ||
			!Object.hasOwn(files, entry)
		) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_ENTRY",
				`Client entry "${entry}" must be a client source file present in the plugin package`,
			);
		}

		const clientFiles = sortBy(
			Object.entries(files).filter(([path]) => path.startsWith(CLIENT_SOURCE_ROOT)),
			([path]) => path,
		);
		const sourceBytes = clientFiles.reduce((total, [, contents]) => total + contents.byteLength, 0);
		if (sourceBytes > CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_SOURCE_SIZE",
				`Client plugin source exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes} bytes`,
			);
		}

		const assetSources = clientFiles.filter(
			([path]) => pluginClientAssetMimeType(path) !== undefined,
		);
		const oversizedAsset = assetSources.find(
			([, contents]) => contents.byteLength > CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes,
		);
		if (oversizedAsset) {
			return yield* failure(
				oversizedAsset[0],
				"RYOT_CLIENT_ASSET_SIZE",
				`Client plugin asset exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes} bytes`,
			);
		}

		const sourceFiles: Record<string, string> = {};
		const decoder = new TextDecoder("utf-8", { fatal: true });
		for (const [path, contents] of clientFiles) {
			if (!isPluginClientTextSource(path)) {
				continue;
			}
			try {
				sourceFiles[path] = decoder.decode(contents);
			} catch {
				return yield* failure(
					path,
					"RYOT_CLIENT_UTF8",
					`Client text source "${path}" is not valid UTF-8`,
				);
			}
		}

		const assetNames = Object.fromEntries(
			assetSources.map(([path, contents]) => [path, clientAssetName(path, contents)]),
		);
		const dependencies = yield* resolveClientPluginCompilerDependencies;
		const bundled = yield* bundleClientPlugin(
			{ entry, assetNames, files: sourceFiles },
			dependencies.compilerRoot,
		);
		if ("diagnostics" in bundled) {
			return yield* clientPluginCompilationFailure(bundled.diagnostics);
		}
		if (bundled.stylesheets.length > 1) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_STYLESHEET",
				"Client plugin sources must import at most one stylesheet",
			);
		}

		const stylesheet = bundled.stylesheets[0];
		const styles = yield* compileClientStyles({
			entry,
			files,
			assetNames,
			sourceFiles,
			themeStylesheet: dependencies.themeStylesheet,
			tailwindStylesheet: dependencies.tailwindStylesheet,
			stylesheet:
				stylesheet === undefined
					? undefined
					: { path: stylesheet, content: sourceFiles[stylesheet] ?? "" },
			scanSources: [
				...clientFiles
					.filter(([path]) => SCANNED_EXTENSIONS.has(extensionOf(path)))
					.map(([path]) => ({
						content: sourceFiles[path] ?? "",
						extension: extensionOf(path),
					})),
				...dependencies.uiSdkScanSources,
			],
		});

		const assetsByName = new Map<string, PluginClientArtifactFile>();
		for (const path of new Set([...bundled.assets, ...styles.assets])) {
			const contents = files[path];
			const name = assetNames[path];
			if (contents === undefined || name === undefined) {
				return yield* failure(
					path,
					"RYOT_CLIENT_ARTIFACT_FILE",
					`Client plugin asset "${path}" could not be emitted`,
				);
			}
			const file = clientAssetArtifactFile(path, name, contents);
			const existing = assetsByName.get(file.name);
			if (existing === undefined) {
				assetsByName.set(file.name, file);
			} else if (
				!bytesEqual(existing.contents, file.contents) ||
				existing.contentType !== file.contentType
			) {
				return yield* failure(
					path,
					"RYOT_CLIENT_ARTIFACT_FILE",
					`Client plugin assets emitted duplicate file name "${file.name}"`,
				);
			}
		}

		const hashedFiles = sortBy(
			[
				clientGeneratedArtifactFile(CLIENT_ARTIFACT_SCRIPT_NAME, bundled.javascript),
				clientGeneratedArtifactFile(CLIENT_ARTIFACT_STYLE_NAME, styles.css),
				...assetsByName.values(),
			],
			(file) => file.name,
		);
		const metadata = clientArtifactMetadata(hashedFiles);
		const artifact: PluginClientArtifact = {
			...metadata,
			files: [
				...hashedFiles,
				clientGeneratedArtifactFile(
					CLIENT_ARTIFACT_DOCUMENT_NAME,
					clientArtifactDocument(metadata),
				),
			],
		};
		const duplicateName = duplicateFileName(artifact.files);
		if (duplicateName !== undefined) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_ARTIFACT_FILE",
				`Client plugin emitted duplicate file name "${duplicateName}"`,
			);
		}

		const artifactBytes = artifact.files.reduce(
			(total, file) => total + file.contents.byteLength,
			0,
		);
		if (artifactBytes > CLIENT_PLUGIN_COMPILER_LIMITS.artifactBytes) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_ARTIFACT_SIZE",
				`Compiled client artifact exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.artifactBytes} bytes`,
			);
		}

		return { artifact };
	});
