import { sortBy } from "@ryot/ts-utils/lodash";
import { Effect } from "effect";

import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";

const TRUSTED_MODULES = new Set(["react", "react-dom", "react-dom/client", "react/jsx-runtime"]);

const TRUSTED_PACKAGES = ["@ryot/client-plugin-sdk", "@ryot/client-ui-sdk"];

export const isTrustedClientModule = (specifier: string) =>
	TRUSTED_MODULES.has(specifier) ||
	TRUSTED_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`));

const directoryOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

const readScanSources = async (root: string) => {
	const paths = await Array.fromAsync(
		new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: root, onlyFiles: true }),
	);
	return Promise.all(
		sortBy(paths.filter((path) => !path.includes(".test."))).map(async (path) => ({
			extension: path.slice(path.lastIndexOf(".") + 1),
			content: await Bun.file(`${root}/${path}`).text(),
		})),
	);
};

export const resolveClientPluginCompilerDependencies = Effect.tryPromise({
	try: async () => {
		const from = Bun.fileURLToPath(new URL(".", import.meta.url));
		const uiSdkRoot = directoryOf(Bun.resolveSync("@ryot/client-ui-sdk", from));
		return {
			compilerRoot: from,
			uiSdkScanSources: await readScanSources(uiSdkRoot),
			tailwindEntry: Bun.resolveSync("tailwindcss/index.css", from),
			themeStylesheet: await Bun.file(
				Bun.resolveSync("@ryot/client-ui-sdk/theme.css", from),
			).text(),
		};
	},
	catch: (error) =>
		clientPluginCompilationFailure([
			clientPluginCompilerDiagnostic(
				"RYOT_CLIENT_COMPILER",
				"client",
				`Client plugin compiler dependencies could not be resolved: ${String(error)}`,
			),
		]),
});
