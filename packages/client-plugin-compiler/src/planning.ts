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
import {
	packageDependencyDeclarations,
	packageValidationSource,
	pageEntrySource,
	pluginRouteEntrySource,
} from "./generated-source";
import type {
	ClientPluginAutomaticRegistryEntry,
	ClientPluginCompilerInput,
	ClientPluginCompilerPublicExport,
} from "./input";

const CLIENT_SOURCE_ROOT = "client/";
const SHARED_SOURCE_ROOT = "shared/";
const PUBLIC_EXPORT_SPECIFIER =
	/^@ryot-app\/plugins\/[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const PUBLIC_EXPORT_NAME = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const CONTRIBUTOR_NAMESPACE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export const isClientSourcePath = (path: string) =>
	path.startsWith(CLIENT_SOURCE_ROOT) || path.includes(`/${CLIENT_SOURCE_ROOT}`);
export const isSharedSourcePath = (path: string) =>
	path.startsWith(SHARED_SOURCE_ROOT) || path.includes(`/${SHARED_SOURCE_ROOT}`);
export const isCompiledTextSource = (path: string) =>
	isSharedSourcePath(path)
		? isPluginSharedSource(path.slice(path.lastIndexOf(SHARED_SOURCE_ROOT)))
		: isPluginClientTextSource(path);

const sourcePathIssue = (path: string) => {
	const canonicalIssue = canonicalRelativePosixPathIssue(path);
	if (canonicalIssue !== null) {
		return canonicalIssue;
	}
	if (path.startsWith(CLIENT_SOURCE_ROOT)) {
		return pluginClientFileExtension(path) === undefined ? "unsupported client file" : null;
	}
	return isPluginSharedSource(path) ? null : "unsupported shared file";
};

const failure = (entry: string, code: string, message: string) =>
	clientPluginCompilationFailure([clientPluginCompilerDiagnostic(code, entry, message)]);

export interface ClientCompilationPlan {
	readonly name: string;
	readonly entry: string;
	readonly files: Readonly<Record<string, Uint8Array>>;
	readonly publicExportPaths: Readonly<Record<string, string>>;
	readonly pluginDependencies: readonly string[];
	readonly bootstrapSource: string;
	readonly typeAliases: Readonly<Record<string, string>>;
	readonly graphValidation?: {
		readonly automaticExports: readonly string[];
		readonly publicExports: Readonly<Record<string, ClientPluginCompilerPublicExport>>;
	};
	readonly dependencyDeclarations?: string;
	readonly limits: "all" | "reachable";
}

const planGraph = (input: Extract<ClientPluginCompilerInput, { readonly contributors: unknown }>) =>
	Effect.gen(function* () {
		if (
			new Set(input.contributorOrder).size !== input.contributorOrder.length ||
			input.contributorOrder.length !== Object.keys(input.contributors).length ||
			input.contributorOrder.some((contributor) => input.contributors[contributor] === undefined)
		) {
			return yield* failure(
				input.entry.contributor,
				"RYOT_CLIENT_CONTRIBUTOR",
				"Contributor order must contain every contributor exactly once",
			);
		}
		const files: Record<string, Uint8Array> = {};
		for (const contributor of sortBy(Object.keys(input.contributors))) {
			if (!CONTRIBUTOR_NAMESPACE.test(contributor)) {
				return yield* failure(
					contributor,
					"RYOT_CLIENT_CONTRIBUTOR",
					`Contributor namespace "${contributor}" is not canonical`,
				);
			}
			for (const [path, contents] of Object.entries(input.contributors[contributor]?.files ?? {})) {
				if (sourcePathIssue(path) !== null) {
					return yield* failure(
						path,
						"RYOT_CLIENT_SOURCE_PATH",
						`Contributor "${contributor}" source "${path}" must be an allowed canonical client/ or shared/ file`,
					);
				}
				files[`contributors/${contributor}/${path}`] = contents;
			}
		}

		if (input.contributors[input.entry.contributor] === undefined) {
			return yield* failure(
				input.entry.contributor,
				"RYOT_CLIENT_ENTRY",
				`Application contributor "${input.entry.contributor}" is missing`,
			);
		}
		const entry = `contributors/${input.entry.contributor}/${input.entry.path}`;
		if (
			(!entry.endsWith(".ts") && !entry.endsWith(".tsx")) ||
			!entry.includes("/client/") ||
			!Object.hasOwn(files, entry)
		) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_ENTRY",
				`Client entry "${entry}" must be a client source file present in the plugin package`,
			);
		}

		const publicExportPaths: Record<string, string> = {};
		for (const [specifier, declaration] of Object.entries(input.publicExports)) {
			if (
				!PUBLIC_EXPORT_SPECIFIER.test(specifier) ||
				input.contributors[declaration.contributor] === undefined ||
				canonicalRelativePosixPathIssue(declaration.entry) !== null ||
				!declaration.entry.startsWith(CLIENT_SOURCE_ROOT)
			) {
				return yield* failure(
					specifier,
					"RYOT_CLIENT_PUBLIC_EXPORT",
					`Public export "${specifier}" has an invalid contributor or client entry`,
				);
			}
			const target = `contributors/${declaration.contributor}/${declaration.entry}`;
			if (!Object.hasOwn(files, target)) {
				return yield* failure(
					specifier,
					"RYOT_CLIENT_PUBLIC_EXPORT",
					`Public export "${specifier}" entry "${declaration.entry}" is missing`,
				);
			}
			publicExportPaths[specifier] = target;
		}

		const registry = input.routeRegistry;
		if (input.application === "plugin-route") {
			const routePaths = new Set(registry?.routes.map(({ path }) => path) ?? []);
			const specifiers = registry
				? [
						registry.home,
						...registry.routes.map(({ exportSpecifier }) => exportSpecifier),
						...(registry.notFound === undefined ? [] : [registry.notFound]),
					]
				: [];
			if (
				!registry ||
				routePaths.size !== registry.routes.length ||
				registry.routes.some(({ path }) => path === "/") ||
				specifiers.some((specifier) => input.publicExports[specifier]?.kind !== "page")
			) {
				return yield* failure(
					entry,
					"RYOT_CLIENT_ROUTE_REGISTRY",
					"Plugin route registry must have one home and unique non-home routes referencing authorized page exports",
				);
			}
		}

		const keys = new Set<string>();
		const checkedAutomaticRegistry: ClientPluginAutomaticRegistryEntry[] = [];
		for (const registration of input.automaticRegistry ?? []) {
			const key = `${registration.ownerPluginId}/${registration.entitySchemaSlug}/${registration.layout}`;
			if (
				keys.has(key) ||
				input.publicExports[registration.exportSpecifier]?.kind !== "presentation"
			) {
				return yield* failure(
					entry,
					"RYOT_CLIENT_AUTOMATIC_REGISTRY",
					"Automatic registry entries must be unique and reference authorized presentation exports",
				);
			}
			keys.add(key);
			checkedAutomaticRegistry.push(registration);
		}
		const automaticRegistry = sortBy(
			checkedAutomaticRegistry,
			({ layout, ownerPluginId, exportSpecifier, entitySchemaSlug }) =>
				`${ownerPluginId}\u0000${entitySchemaSlug}\u0000${layout}\u0000${exportSpecifier}`,
		);
		const applicationSource =
			input.application === "plugin-route" && registry
				? pluginRouteEntrySource(registry, automaticRegistry)
				: pageEntrySource(automaticRegistry);
		return {
			entry,
			files,
			name: input.name,
			publicExportPaths,
			limits: "reachable",
			pluginDependencies: [],
			bootstrapSource: `${applicationSource}\nimport "./styles.css";\n`,
			typeAliases: { "@ryot-internal/application-entry": entry, ...publicExportPaths },
			graphValidation: {
				publicExports: input.publicExports,
				automaticExports: automaticRegistry.map(({ exportSpecifier }) => exportSpecifier),
			},
		} satisfies ClientCompilationPlan;
	});

const planPackage = (input: Extract<ClientPluginCompilerInput, { readonly files: unknown }>) =>
	Effect.gen(function* () {
		for (const path of Object.keys(input.files)) {
			if (
				(path.startsWith(CLIENT_SOURCE_ROOT) || path.startsWith(SHARED_SOURCE_ROOT)) &&
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
			limits: "all",
			entry: "client",
			name: input.name,
			files: input.files,
			pluginDependencies,
			publicExportPaths: {},
			...(declarations === "" ? {} : { dependencyDeclarations: declarations }),
			bootstrapSource: `${packageValidationSource(input.publicExports)}\nimport "./styles.css";\n`,
		} satisfies ClientCompilationPlan;
	});

export const planClientCompilation = (
	input: ClientPluginCompilerInput,
): Effect.Effect<ClientCompilationPlan, ClientPluginCompilerFailure> => {
	if ("contributors" in input) {
		return planGraph(input);
	}
	return planPackage(input);
};

export const sourceAssetEntries = (files: Readonly<Record<string, Uint8Array>>) =>
	Object.entries(files).filter(
		([path]) => isClientSourcePath(path) && pluginClientAssetMimeType(path) !== undefined,
	);
