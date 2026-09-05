import { resolveTypeScriptCompilerPath } from "@ryot-app/typescript-compiler";
import { Effect } from "effect";

import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";

const CLIENT_DEPENDENCY_REGISTRY = [
	{ policy: "trusted", specifier: "clsx", typesPackage: "clsx", typesPath: "clsx.d.mts" },
	{ policy: "trusted", specifier: "react", typesPath: "index.d.ts", typesPackage: "@types/react" },
	{
		policy: "trusted",
		specifier: "react-dom",
		typesPath: "index.d.ts",
		typesPackage: "@types/react-dom",
	},
	{
		policy: "trusted",
		typesPath: "client.d.ts",
		specifier: "react-dom/client",
		typesPackage: "@types/react-dom",
	},
	{
		policy: "trusted",
		typesPackage: "@types/react",
		typesPath: "jsx-runtime.d.ts",
		specifier: "react/jsx-runtime",
	},
	{ policy: "trusted", specifier: "@ryot-app/client-sdk" },
	{ policy: "trusted", specifier: "@ryot-app/client-sdk/effect" },
	{ policy: "trusted", specifier: "@ryot-app/client-sdk/plugin" },
	{ policy: "trusted", specifier: "@ryot-app/client-sdk/react" },
	{ policy: "trusted", specifier: "@ryot-app/client-sdk/ryotql" },
	{ policy: "trusted", specifier: "@ryot-app/client-sdk/screen" },
	{ policy: "trusted", specifier: "@ryot-app/ryotql-recipes/collections" },
	{ policy: "trusted", specifier: "@ryot-app/ryotql-recipes/saved-views" },
	{ policy: "trusted", specifier: "@ryot-app/client-ui-sdk" },
	{ policy: "trusted", specifier: "@ryot-app/client-ui-sdk/icon" },
	{ policy: "trusted", specifier: "@ryot-app/client-ui-sdk/sync" },
	{ policy: "trusted", specifier: "@ryot-app/client-ui-sdk/tint" },
	{ policy: "trusted", specifier: "@ryot-app/client-ui-sdk/table" },
	{ policy: "trusted", specifier: "@ryot-app/client-ui-sdk/schema-form" },
	{ policy: "neutral", specifier: "@ryot-app/plugin-kit/effect" },
	{ policy: "neutral", specifier: "@ryot-app/plugin-kit/ryotql" },
	{ policy: "neutral", specifier: "@ryot-app/plugin-kit/schema" },
] as const;

const trustedModules = new Set<string>(
	CLIENT_DEPENDENCY_REGISTRY.filter(({ policy }) => policy === "trusted").map(
		({ specifier }) => specifier,
	),
);
const neutralModules = new Set<string>(
	CLIENT_DEPENDENCY_REGISTRY.filter(({ policy }) => policy === "neutral").map(
		({ specifier }) => specifier,
	),
);

export const isTrustedClientModule = (specifier: string) => trustedModules.has(specifier);
export const isNeutralPluginModule = (specifier: string) => neutralModules.has(specifier);

const directoryOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

const resolveTypeScriptEntries = (from: string) => {
	const packageRoots = new Map<string, string>();
	return Object.fromEntries(
		CLIENT_DEPENDENCY_REGISTRY.map((dependency) => {
			if (!("typesPackage" in dependency)) {
				return [dependency.specifier, Bun.resolveSync(dependency.specifier, from)];
			}
			let root = packageRoots.get(dependency.typesPackage);
			if (root === undefined) {
				root = directoryOf(Bun.resolveSync(`${dependency.typesPackage}/package.json`, from));
				packageRoots.set(dependency.typesPackage, root);
			}
			return [dependency.specifier, `${root}/${dependency.typesPath}`];
		}),
	);
};

export const resolveClientPluginCompilerDependencies = Effect.try({
	catch: (error) =>
		clientPluginCompilationFailure([
			clientPluginCompilerDiagnostic(
				"RYOT_CLIENT_COMPILER",
				"client",
				`Client plugin compiler dependencies could not be resolved: ${String(error)}`,
			),
		]),
	try: () => {
		const compilerRoot = Bun.fileURLToPath(new URL("..", import.meta.url));
		return {
			compilerRoot,
			typeScriptEntries: resolveTypeScriptEntries(compilerRoot),
			tsserverPath: resolveTypeScriptCompilerPath(compilerRoot),
			uiSdkRoot: directoryOf(Bun.resolveSync("@ryot-app/client-ui-sdk", compilerRoot)),
			clientSdkRoot: directoryOf(Bun.resolveSync("@ryot-app/client-sdk", compilerRoot)),
		};
	},
});
