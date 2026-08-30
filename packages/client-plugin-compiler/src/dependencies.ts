import { resolveTypeScriptCompilerPath } from "@ryot-app/typescript-compiler";
import { Effect } from "effect";

import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";

const NEUTRAL_MODULES = [
	"@ryot-app/plugin-kit/effect",
	"@ryot-app/plugin-kit/ryotql",
	"@ryot-app/plugin-kit/schema",
] as const;

const NEUTRAL_MODULE_SET = new Set<string>(NEUTRAL_MODULES);

const TRUSTED_MODULES = new Set([
	"clsx",
	"react",
	"react-dom",
	"react-dom/client",
	"react/jsx-runtime",
	"@ryot-app/client-sdk",
	"@ryot-app/client-sdk/effect",
	"@ryot-app/client-sdk/plugin",
	"@ryot-app/client-sdk/react",
	"@ryot-app/client-sdk/ryotql",
	"@ryot-app/client-sdk/screen",
	"@ryot-app/ryotql-recipes/saved-views",
	"@ryot-app/client-ui-sdk",
	"@ryot-app/client-ui-sdk/icon",
	"@ryot-app/client-ui-sdk/sync",
	"@ryot-app/client-ui-sdk/tint",
	"@ryot-app/client-ui-sdk/table",
	"@ryot-app/client-ui-sdk/schema-form",
]);

export const isTrustedClientModule = (specifier: string) => TRUSTED_MODULES.has(specifier);

export const isNeutralPluginModule = (specifier: string) => NEUTRAL_MODULE_SET.has(specifier);

const directoryOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

const resolveTypeScriptEntries = (from: string) => {
	const reactTypesRoot = directoryOf(Bun.resolveSync("@types/react/package.json", from));
	const reactDomTypesRoot = directoryOf(Bun.resolveSync("@types/react-dom/package.json", from));
	const clsxRoot = directoryOf(Bun.resolveSync("clsx/package.json", from));
	return {
		clsx: `${clsxRoot}/clsx.d.mts`,
		react: `${reactTypesRoot}/index.d.ts`,
		"react-dom": `${reactDomTypesRoot}/index.d.ts`,
		"react-dom/client": `${reactDomTypesRoot}/client.d.ts`,
		"react/jsx-runtime": `${reactTypesRoot}/jsx-runtime.d.ts`,
		"@ryot-app/client-sdk": Bun.resolveSync("@ryot-app/client-sdk", from),
		"@ryot-app/client-ui-sdk": Bun.resolveSync("@ryot-app/client-ui-sdk", from),
		"@ryot-app/client-sdk/react": Bun.resolveSync("@ryot-app/client-sdk/react", from),
		"@ryot-app/client-sdk/effect": Bun.resolveSync("@ryot-app/client-sdk/effect", from),
		"@ryot-app/client-sdk/plugin": Bun.resolveSync("@ryot-app/client-sdk/plugin", from),
		"@ryot-app/client-sdk/ryotql": Bun.resolveSync("@ryot-app/client-sdk/ryotql", from),
		"@ryot-app/client-sdk/screen": Bun.resolveSync("@ryot-app/client-sdk/screen", from),
		"@ryot-app/plugin-kit/effect": Bun.resolveSync("@ryot-app/plugin-kit/effect", from),
		"@ryot-app/plugin-kit/ryotql": Bun.resolveSync("@ryot-app/plugin-kit/ryotql", from),
		"@ryot-app/plugin-kit/schema": Bun.resolveSync("@ryot-app/plugin-kit/schema", from),
		"@ryot-app/client-ui-sdk/icon": Bun.resolveSync("@ryot-app/client-ui-sdk/icon", from),
		"@ryot-app/client-ui-sdk/sync": Bun.resolveSync("@ryot-app/client-ui-sdk/sync", from),
		"@ryot-app/client-ui-sdk/tint": Bun.resolveSync("@ryot-app/client-ui-sdk/tint", from),
		"@ryot-app/client-ui-sdk/table": Bun.resolveSync("@ryot-app/client-ui-sdk/table", from),
		"@ryot-app/client-ui-sdk/schema-form": Bun.resolveSync(
			"@ryot-app/client-ui-sdk/schema-form",
			from,
		),
		"@ryot-app/ryotql-recipes/saved-views": Bun.resolveSync(
			"@ryot-app/ryotql-recipes/saved-views",
			from,
		),
	};
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
