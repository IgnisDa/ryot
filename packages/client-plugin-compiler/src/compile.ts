import { BunFileSystem } from "@effect/platform-bun";
import type { PluginClientArtifact } from "@ryot-app/client-plugin-contract";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import {
	acquireCompilerWorkspace,
	stageGeneratedFiles,
	stageSourceFiles,
	ViteBuildService,
} from "@ryot-app/vite-compiler";
import { Effect, Layer } from "effect";

import {
	CLIENT_ARTIFACT_DOCUMENT_NAME,
	clientArtifactFile,
	clientArtifactMetadata,
} from "./artifact";
import { bundleClientPlugin } from "./bundle";
import { resolveClientPluginCompilerDependencies } from "./dependencies";
import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";
import {
	ARTIFACT_METADATA_PLACEHOLDER,
	compilerStylesheet,
	generatedDocument,
	GENERATED_BOOTSTRAP,
	GENERATED_VALIDATION,
	graphValidationSource,
} from "./generated-source";
import type { ClientPluginCompilerInput } from "./input";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "./limits";
import {
	isClientSourcePath,
	isCompiledTextSource,
	isSharedSourcePath,
	planClientCompilation,
	sourceAssetEntries,
} from "./planning";
import { analyzeClientPluginTypes } from "./semantic-check";
import { validateClientSourcePolicy } from "./styles";

const compilerLayer = Layer.merge(BunFileSystem.layer, ViteBuildService.layer);
const SUPPORTED_OUTPUT_MIME =
	/^(?:text\/(?:html|css|javascript); charset=utf-8|image\/(?:png|gif|jpeg|webp|avif|x-icon|svg\+xml)|font\/woff2|application\/wasm)$/;

const failure = (entry: string, code: string, message: string) =>
	clientPluginCompilationFailure([clientPluginCompilerDiagnostic(code, entry, message)]);

const outputReferenceIssue = (
	name: string,
	contents: string,
	contentType: string,
	names: ReadonlySet<string>,
	pluginDependencies: ReadonlySet<string>,
) => {
	let pattern = /(?:\bimport\s*\(\s*|\bnew\s+URL\s*\(\s*)["'`]([^"'`]+)["'`]/g;
	if (contentType.startsWith("text/html")) {
		pattern = /(?:src|href)=["']([^"']+)["']/g;
	} else if (contentType.startsWith("text/css")) {
		pattern = /url\(\s*["']?([^"')]+)/g;
	}
	for (const match of contents.matchAll(pattern)) {
		const reference = match[1];
		const pluginSlug = reference
			?.match(
				/^@ryot-app\/plugins\/[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
			)?.[0]
			.split("/")[2];
		if (
			!reference ||
			reference.startsWith("#") ||
			reference.startsWith("data:") ||
			/^[a-z][\w+.-]*:/i.test(reference) ||
			reference.startsWith("//") ||
			(pluginSlug !== undefined && pluginDependencies.has(pluginSlug))
		) {
			continue;
		}
		const target = reference.split(/[?#]/, 1)[0]?.replace(/^\.\//, "") ?? "";
		if (target.startsWith("/") || target.includes("..") || !names.has(target)) {
			return `Emitted file "${name}" references missing or escaping path "${reference}"`;
		}
	}
	return null;
};

export const compileClientPlugin = (input: ClientPluginCompilerInput) =>
	Effect.gen(function* () {
		// Plan and normalize both public input variants before any compiler work starts.
		const plan = yield* planClientCompilation(input);
		const compiledFiles = sortBy(
			Object.entries(plan.files).filter(
				([path]) => isClientSourcePath(path) || isSharedSourcePath(path),
			),
			([path]) => path,
		);
		if (
			plan.limits === "all" &&
			compiledFiles.reduce((total, [, contents]) => total + contents.byteLength, 0) >
				CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes
		) {
			return yield* failure(
				plan.entry,
				"RYOT_CLIENT_SOURCE_SIZE",
				`Client plugin source exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes} bytes`,
			);
		}
		const oversizedSourceAsset = sourceAssetEntries(plan.files).find(
			([, contents]) => contents.byteLength > CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes,
		);
		if (plan.limits === "all" && oversizedSourceAsset) {
			return yield* failure(
				oversizedSourceAsset[0],
				"RYOT_CLIENT_ASSET_SIZE",
				`Client plugin asset exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes} bytes`,
			);
		}

		// Decode text and enforce source policy and limits before semantic analysis.
		const sourceFiles: Record<string, string> = {};
		const decoder = new TextDecoder("utf-8", { fatal: true });
		for (const [path, contents] of compiledFiles) {
			if (!isCompiledTextSource(path)) {
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
		if (plan.dependencyDeclarations !== undefined) {
			sourceFiles["client/__ryot_plugin_dependencies__.d.ts"] = plan.dependencyDeclarations;
		}
		const dependencies = yield* resolveClientPluginCompilerDependencies;
		const policyDiagnostics = validateClientSourcePolicy({
			sourceFiles,
			files: plan.files,
			publicExports: plan.publicExportPaths,
			unresolvedPluginDependencies: plan.pluginDependencies,
		});
		if (policyDiagnostics.length > 0) {
			return yield* clientPluginCompilationFailure(policyDiagnostics);
		}

		// Analyze the reachable application graph, then validate its public export contracts.
		const analysisFiles = { ...sourceFiles, [GENERATED_BOOTSTRAP]: plan.bootstrapSource };
		const analysis = yield* analyzeClientPluginTypes(
			analysisFiles,
			dependencies,
			plan.typeAliases,
			plan.graphValidation ? [GENERATED_BOOTSTRAP] : undefined,
		).pipe(
			Effect.mapError((error) =>
				failure(plan.entry, "RYOT_CLIENT_COMPILER", `TypeScript compiler failed: ${String(error)}`),
			),
		);
		if (analysis.diagnostics.length > 0) {
			return yield* clientPluginCompilationFailure(analysis.diagnostics);
		}
		const reachableSources = plan.graphValidation
			? analysis.sources.filter((path) => path !== GENERATED_BOOTSTRAP)
			: Object.keys(sourceFiles);
		if (plan.graphValidation) {
			const reachablePublicExports = sortBy([
				...new Set([
					...plan.graphValidation.automaticExports,
					...Object.entries(plan.publicExportPaths).flatMap(([specifier, path]) =>
						reachableSources.includes(path) ? [specifier] : [],
					),
				]),
			]);
			const checkedAnalysis = yield* analyzeClientPluginTypes(
				{
					...sourceFiles,
					[GENERATED_VALIDATION]: graphValidationSource(
						reachablePublicExports,
						plan.graphValidation.publicExports,
					),
				},
				dependencies,
				plan.typeAliases,
				[GENERATED_VALIDATION],
			).pipe(
				Effect.mapError((error) =>
					failure(
						plan.entry,
						"RYOT_CLIENT_COMPILER",
						`TypeScript compiler failed: ${String(error)}`,
					),
				),
			);
			if (checkedAnalysis.diagnostics.length > 0) {
				return yield* clientPluginCompilationFailure(checkedAnalysis.diagnostics);
			}
			const reachableSourceBytes = reachableSources.reduce(
				(total, path) => total + (plan.files[path]?.byteLength ?? 0),
				0,
			);
			if (reachableSourceBytes > CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes) {
				return yield* failure(
					plan.entry,
					"RYOT_CLIENT_SOURCE_SIZE",
					`Client plugin source exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes} bytes`,
				);
			}
		}

		// Stage only validated sources and compiler-owned generated entries.
		const workspace = yield* acquireCompilerWorkspace({
			parentPath: dependencies.compilerRoot,
		}).pipe(Effect.mapError((error) => failure(plan.entry, "RYOT_CLIENT_COMPILER", error.message)));
		yield* stageSourceFiles(
			workspace,
			compiledFiles.map(([path, contents]) => ({ path, contents })),
		).pipe(
			Effect.mapError((error) => failure(plan.entry, "RYOT_CLIENT_SOURCE_PATH", error.message)),
		);
		yield* stageGeneratedFiles(workspace, [
			{ path: "bootstrap.tsx", contents: plan.bootstrapSource },
			{ path: "index.html", contents: generatedDocument(plan.name) },
			{
				path: "styles.css",
				contents: compilerStylesheet(
					reachableSources,
					workspace.sourcePath,
					workspace.generatedPath,
					dependencies.clientSdkRoot,
					dependencies.uiSdkRoot,
				),
			},
		]).pipe(Effect.mapError((error) => failure(plan.entry, "RYOT_CLIENT_COMPILER", error.message)));

		// Build with Vite, then validate and finalize the deterministic artifact.
		const bundled = yield* bundleClientPlugin({
			workspace,
			entry: plan.entry,
			publicExports: plan.typeAliases,
			unresolvedPluginDependencies: plan.pluginDependencies,
		});
		const emittedErrors = bundled.diagnostics.filter(({ severity }) => severity === "error");
		if (emittedErrors.length > 0) {
			return yield* clientPluginCompilationFailure(emittedErrors);
		}
		if (bundled.files.length > CLIENT_PLUGIN_COMPILER_LIMITS.artifactFileCount) {
			return yield* failure(
				plan.entry,
				"RYOT_CLIENT_ARTIFACT_FILE",
				"Compiled client artifact emits too many files",
			);
		}
		const oversizedOutputAsset = bundled.files.find(
			(file) =>
				!file.contentType.startsWith("text/") &&
				file.bytes.byteLength > CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes,
		);
		if (oversizedOutputAsset) {
			return yield* failure(
				plan.entry,
				"RYOT_CLIENT_ASSET_SIZE",
				`Emitted client asset "${oversizedOutputAsset.path}" exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes} bytes`,
			);
		}
		const html = bundled.files.find(({ path }) => path === CLIENT_ARTIFACT_DOCUMENT_NAME);
		if (!html) {
			return yield* failure(
				plan.entry,
				"RYOT_CLIENT_ARTIFACT_FILE",
				`Vite did not emit index.html (${bundled.files.map(({ path }) => path).join(", ")})`,
			);
		}
		const hashedFiles = bundled.files
			.filter(({ path }) => path !== CLIENT_ARTIFACT_DOCUMENT_NAME)
			.map(clientArtifactFile);
		const names = new Set(hashedFiles.map(({ name }) => name));
		names.add(CLIENT_ARTIFACT_DOCUMENT_NAME);
		const pluginDependencies = new Set(plan.pluginDependencies);
		for (const file of bundled.files) {
			if (!SUPPORTED_OUTPUT_MIME.test(file.contentType)) {
				return yield* failure(
					plan.entry,
					"RYOT_CLIENT_ARTIFACT_FILE",
					`Vite emitted unsupported MIME type "${file.contentType}"`,
				);
			}
			if (file.contentType.startsWith("text/")) {
				const issue = outputReferenceIssue(
					file.path,
					decoder.decode(file.bytes),
					file.contentType,
					names,
					pluginDependencies,
				);
				if (issue) {
					return yield* failure(plan.entry, "RYOT_CLIENT_ARTIFACT_FILE", issue);
				}
			}
		}
		const metadata = clientArtifactMetadata(plan.name, hashedFiles);
		const emittedDocument = decoder.decode(html.bytes);
		if (!emittedDocument.includes(ARTIFACT_METADATA_PLACEHOLDER)) {
			return yield* failure(
				plan.entry,
				"RYOT_CLIENT_ARTIFACT_FILE",
				"Vite HTML lost the artifact metadata placeholder",
			);
		}
		const artifact: PluginClientArtifact = {
			...metadata,
			files: sortBy(
				[
					...hashedFiles,
					clientArtifactFile({
						contentType: html.contentType,
						path: CLIENT_ARTIFACT_DOCUMENT_NAME,
						bytes: new TextEncoder().encode(
							emittedDocument.replace(ARTIFACT_METADATA_PLACEHOLDER, JSON.stringify(metadata)),
						),
					}),
				],
				({ name }) => name,
			),
		};
		const artifactBytes = artifact.files.reduce(
			(total, file) => total + file.contents.byteLength,
			0,
		);
		if (artifactBytes > CLIENT_PLUGIN_COMPILER_LIMITS.artifactBytes) {
			return yield* failure(
				plan.entry,
				"RYOT_CLIENT_ARTIFACT_SIZE",
				`Compiled client artifact exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.artifactBytes} bytes`,
			);
		}
		return { artifact };
	}).pipe(Effect.provide(compilerLayer), Effect.scoped);
