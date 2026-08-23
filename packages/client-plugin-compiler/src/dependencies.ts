import { sortBy } from "@ryot/ts-utils/lodash";
import { Effect } from "effect";

import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";

const TRUSTED_MODULES = new Set([
	"clsx",
	"react",
	"react-dom",
	"react-dom/client",
	"react/jsx-runtime",
	"@ryot/client-sdk",
	"@ryot/client-sdk/effect",
	"@ryot/client-sdk/plugin",
	"@ryot/client-sdk/react",
	"@ryot/client-sdk/ryotql",
	"@ryot/client-ui-sdk",
]);

export const isTrustedClientModule = (specifier: string) => TRUSTED_MODULES.has(specifier);

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
		const tailwindEntry = Bun.resolveSync("tailwindcss/index.css", from);
		return {
			compilerRoot: from,
			uiSdkScanSources: await readScanSources(uiSdkRoot),
			tailwindStylesheet: {
				path: tailwindEntry,
				content: await Bun.file(tailwindEntry).text(),
			},
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
