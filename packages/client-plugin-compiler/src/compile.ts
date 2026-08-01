import type {
	CLIENT_API_VERSION,
	PluginClientArtifact,
	PluginClientArtifactFile,
} from "@ryot/contract/modules/plugins/client";
import { sortBy } from "@ryot/ts-utils/lodash";
import { Effect } from "effect";

import {
	CLIENT_ARTIFACT_DOCUMENT_NAME,
	CLIENT_ARTIFACT_SCRIPT_NAME,
	CLIENT_ARTIFACT_STYLE_NAME,
	clientArtifactDocument,
	clientArtifactFile,
	clientArtifactMetadata,
	clientAssetName,
} from "./artifact";
import { bundleClientPlugin } from "./bundle";
import { resolveClientPluginCompilerDependencies } from "./dependencies";
import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";
import { CLIENT_PLUGIN_COMPILER_LIMITS, utf8ByteLength } from "./limits";
import { compileClientStyles } from "./styles";

const CLIENT_SOURCE_ROOT = "client/";
const SCANNED_EXTENSIONS = new Set(["ts", "tsx"]);

export type ClientPluginCompilerInput = {
	readonly entry: string;
	readonly apiVersion: typeof CLIENT_API_VERSION;
	readonly files: Readonly<Record<string, string>>;
};

const extensionOf = (path: string) => path.slice(path.lastIndexOf(".") + 1);

const failure = (entry: string, code: string, message: string) =>
	clientPluginCompilationFailure([clientPluginCompilerDiagnostic(code, entry, message)]);

export const compileClientPlugin = ({ entry, files }: ClientPluginCompilerInput) =>
	Effect.gen(function* () {
		if (!entry.startsWith(CLIENT_SOURCE_ROOT) || !Object.hasOwn(files, entry)) {
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
		const sourceBytes = clientFiles.reduce(
			(total, [, contents]) => total + utf8ByteLength(contents),
			0,
		);
		if (sourceBytes > CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_SOURCE_SIZE",
				`Client plugin source exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes} UTF-8 bytes`,
			);
		}

		const assetSources = clientFiles.filter(
			([path]) => !SCANNED_EXTENSIONS.has(extensionOf(path)) && !path.endsWith(".css"),
		);
		const oversizedAsset = assetSources.find(
			([, contents]) => utf8ByteLength(contents) > CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes,
		);
		if (oversizedAsset) {
			return yield* failure(
				oversizedAsset[0],
				"RYOT_CLIENT_ASSET_SIZE",
				`Client plugin asset exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes} UTF-8 bytes`,
			);
		}

		const assetNames = Object.fromEntries(
			assetSources.map(([path, contents]) => [path, clientAssetName(path, contents)]),
		);
		const dependencies = yield* resolveClientPluginCompilerDependencies;
		const bundled = yield* bundleClientPlugin(
			{ entry, files, assetNames },
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
		const css = yield* compileClientStyles(
			stylesheet === undefined ? "" : (files[stylesheet] ?? ""),
			[
				...clientFiles
					.filter(([path]) => SCANNED_EXTENSIONS.has(extensionOf(path)))
					.map(([path, contents]) => ({ content: contents, extension: extensionOf(path) })),
				...dependencies.uiSdkScanSources,
			],
			dependencies.tailwindEntry,
			entry,
		);

		const hashedFiles: PluginClientArtifactFile[] = sortBy(
			[
				clientArtifactFile(CLIENT_ARTIFACT_SCRIPT_NAME, bundled.javascript),
				clientArtifactFile(CLIENT_ARTIFACT_STYLE_NAME, css),
				...bundled.assets.map((path) =>
					clientArtifactFile(assetNames[path] ?? path, files[path] ?? ""),
				),
			],
			(file) => file.name,
		);
		const metadata = clientArtifactMetadata(hashedFiles);
		const artifact: PluginClientArtifact = {
			...metadata,
			files: [
				...hashedFiles,
				clientArtifactFile(CLIENT_ARTIFACT_DOCUMENT_NAME, clientArtifactDocument(metadata)),
			],
		};

		const artifactBytes = artifact.files.reduce(
			(total, file) => total + utf8ByteLength(file.contents),
			0,
		);
		if (artifactBytes > CLIENT_PLUGIN_COMPILER_LIMITS.artifactBytes) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_ARTIFACT_SIZE",
				`Compiled client artifact exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.artifactBytes} UTF-8 bytes`,
			);
		}

		return { artifact };
	});
