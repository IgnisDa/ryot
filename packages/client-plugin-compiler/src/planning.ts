import {
	isPluginClientTextSource,
	pluginClientAssetMimeType,
	pluginClientFileExtension,
} from "@ryot-app/client-plugin-contract";
import { isPluginSharedSource } from "@ryot-app/contract/modules/plugins/shared-file-policy";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { Effect } from "effect";

import {
	clientPluginCompilationFailure,
	clientPluginCompilerDiagnostic,
	type ClientPluginCompilerFailure,
} from "./diagnostics";
import { packageDependencyDeclarations, packageValidationSource } from "./generated-source";
import type { ClientPluginCompilerPackageInput } from "./input";

const CLIENT_SOURCE_ROOT = "client/";
const SHARED_SOURCE_ROOT = "shared/";
const PUBLIC_EXPORT_NAME = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export const isClientSourcePath = (path: string) => path.startsWith(CLIENT_SOURCE_ROOT);
export const isSharedSourcePath = (path: string) => path.startsWith(SHARED_SOURCE_ROOT);
export const isCompiledTextSource = (path: string) =>
	isSharedSourcePath(path) ? isPluginSharedSource(path) : isPluginClientTextSource(path);

const sourcePathIssue = (path: string) => {
	const canonicalIssue = canonicalRelativePosixPathIssue(path);
	if (canonicalIssue !== null) {
		return canonicalIssue;
	}
	if (isClientSourcePath(path)) {
		return pluginClientFileExtension(path) === undefined ? "unsupported client file" : null;
	}
	return isPluginSharedSource(path) ? null : "unsupported shared file";
};

const failure = (entry: string, code: string, message: string) =>
	clientPluginCompilationFailure([clientPluginCompilerDiagnostic(code, entry, message)]);

export interface ClientCompilationPlan {
	readonly entry: string;
	readonly files: Readonly<Record<string, Uint8Array>>;
	readonly pluginDependencies: readonly string[];
	readonly validationSource: string;
	readonly typeAliases: Readonly<Record<string, string>>;
	readonly dependencyDeclarations?: string;
}

export const planClientCompilation = (
	input: ClientPluginCompilerPackageInput,
): Effect.Effect<ClientCompilationPlan, ClientPluginCompilerFailure> =>
	Effect.gen(function* () {
		for (const path of Object.keys(input.files)) {
			if (
				(isClientSourcePath(path) || isSharedSourcePath(path)) &&
				sourcePathIssue(path) !== null
			) {
				return yield* failure(
					path,
					"RYOT_CLIENT_SOURCE_PATH",
					`Source "${path}" must be an allowed canonical client/ or shared/ file`,
				);
			}
		}
		for (const [name, declaration] of Object.entries(input.publicExports)) {
			if (
				!PUBLIC_EXPORT_NAME.test(name) ||
				canonicalRelativePosixPathIssue(declaration.entry) !== null ||
				!declaration.entry.startsWith(CLIENT_SOURCE_ROOT) ||
				pluginClientFileExtension(declaration.entry) === undefined ||
				!Object.hasOwn(input.files, declaration.entry)
			) {
				return yield* failure(
					declaration.entry,
					"RYOT_CLIENT_PUBLIC_EXPORT",
					`Public export "${name}" must reference a client TypeScript source present in the plugin package`,
				);
			}
		}
		const pluginDependencies = input.pluginDependencies ?? [];
		const typeAliases = Object.fromEntries(
			sortBy(Object.entries(input.publicExports), ([name]) => name).map(
				([, declaration], index) => [`@ryot-internal/package-export-${index}`, declaration.entry],
			),
		);
		const declarations = packageDependencyDeclarations(pluginDependencies);
		return {
			typeAliases,
			entry: "client",
			files: input.files,
			pluginDependencies,
			...(declarations === "" ? {} : { dependencyDeclarations: declarations }),
			validationSource: packageValidationSource(input.publicExports),
		};
	});

export const sourceAssetEntries = (files: Readonly<Record<string, Uint8Array>>) =>
	Object.entries(files).filter(
		([path]) => isClientSourcePath(path) && pluginClientAssetMimeType(path) !== undefined,
	);
