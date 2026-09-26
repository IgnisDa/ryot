import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect } from "effect";

import { resolveClientPluginCompilerDependencies } from "./dependencies";
import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";
import { GENERATED_VALIDATION } from "./generated-source";
import type { ClientPluginCompilerPackageInput } from "./input";
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

const failure = (entry: string, code: string, message: string) =>
	clientPluginCompilationFailure([clientPluginCompilerDiagnostic(code, entry, message)]);

export const validateClientPluginPackage = (input: ClientPluginCompilerPackageInput) =>
	Effect.gen(function* () {
		const plan = yield* planClientCompilation(input);
		const compiledFiles = sortBy(
			Object.entries(plan.files).filter(
				([path]) => isClientSourcePath(path) || isSharedSourcePath(path),
			),
			([path]) => path,
		);
		if (
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
		if (oversizedSourceAsset) {
			return yield* failure(
				oversizedSourceAsset[0],
				"RYOT_CLIENT_ASSET_SIZE",
				`Client plugin asset exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes} bytes`,
			);
		}

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
			publicExports: {},
			unresolvedPluginDependencies: plan.pluginDependencies,
		});
		if (policyDiagnostics.length > 0) {
			return yield* clientPluginCompilationFailure(policyDiagnostics);
		}
		const analysis = yield* analyzeClientPluginTypes(
			{ ...sourceFiles, [GENERATED_VALIDATION]: plan.validationSource },
			dependencies,
			plan.typeAliases,
		).pipe(
			Effect.mapError((error) =>
				failure(plan.entry, "RYOT_CLIENT_COMPILER", `TypeScript compiler failed: ${String(error)}`),
			),
		);
		if (analysis.diagnostics.length > 0) {
			return yield* clientPluginCompilationFailure(analysis.diagnostics);
		}
		return { dependencies, compiledFiles };
	});
