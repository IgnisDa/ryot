import { sortBy } from "@ryot-app/ts-utils/lodash";
import { resolveTypeScriptCompilerPath } from "@ryot-app/typescript-compiler";
import { Effect } from "effect";
import { parse } from "postcss";
import valueParser from "postcss-value-parser";

import { clientAssetArtifactFile, clientAssetName } from "./artifact";
import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";

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
	"@ryot-app/client-ui-sdk",
	"@ryot-app/client-ui-sdk/table",
]);

export const isTrustedClientModule = (specifier: string) => TRUSTED_MODULES.has(specifier);

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
		"@ryot-app/client-sdk/effect": Bun.resolveSync("@ryot-app/client-sdk/effect", from),
		"@ryot-app/client-sdk/plugin": Bun.resolveSync("@ryot-app/client-sdk/plugin", from),
		"@ryot-app/client-sdk/react": Bun.resolveSync("@ryot-app/client-sdk/react", from),
		"@ryot-app/client-sdk/ryotql": Bun.resolveSync("@ryot-app/client-sdk/ryotql", from),
		"@ryot-app/client-ui-sdk": Bun.resolveSync("@ryot-app/client-ui-sdk", from),
		"@ryot-app/client-ui-sdk/table": Bun.resolveSync("@ryot-app/client-ui-sdk/table", from),
	};
};

const readFontsource = async (specifier: string, from: string) => {
	const entry = Bun.resolveSync(specifier, from);
	const root = parse(await Bun.file(entry).text(), { from: entry });
	const paths = new Set<string>();
	root.walkDecls((declaration) => {
		const parsed = valueParser(declaration.value);
		parsed.walk((node) => {
			if (node.type !== "function" || node.value.toLowerCase() !== "url") {
				return;
			}
			const values = node.nodes.filter(
				(child) => child.type !== "space" && child.type !== "comment" && child.type !== "div",
			);
			const target = values[0];
			if (
				values.length !== 1 ||
				(target?.type !== "string" && target?.type !== "word") ||
				!/^\.\/files\/[^/]+\.woff2$/.test(target.value)
			) {
				throw new Error(`Fontsource stylesheet "${entry}" contains an unsupported asset URL`);
			}
			paths.add(target.value);
		});
	});

	const assets = await Promise.all(
		sortBy([...paths]).map(async (path) => {
			const contents = new Uint8Array(
				await Bun.file(`${directoryOf(entry)}/${path.slice(2)}`).arrayBuffer(),
			);
			const name = clientAssetName(path, contents);
			return { path, file: clientAssetArtifactFile(path, name, contents) };
		}),
	);
	const names = new Map(assets.map(({ file, path }) => [path, file.name]));
	root.walkDecls((declaration) => {
		const parsed = valueParser(declaration.value);
		parsed.walk((node) => {
			if (node.type !== "function" || node.value.toLowerCase() !== "url") {
				return;
			}
			const target = node.nodes.find((child) => child.type === "string" || child.type === "word");
			if (target) {
				const name = names.get(target.value);
				if (name === undefined) {
					throw new Error(`Fontsource stylesheet "${entry}" contains an unresolved asset URL`);
				}
				target.value = `./${name}`;
			}
		});
		declaration.value = valueParser.stringify(parsed.nodes);
	});
	return { assets: assets.map(({ file }) => file), stylesheet: root.toString() };
};

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
		const uiSdkRoot = directoryOf(Bun.resolveSync("@ryot-app/client-ui-sdk", from));
		const tailwindEntry = Bun.resolveSync("tailwindcss/index.css", from);
		const fonts = await Promise.all(
			["@fontsource-variable/outfit", "@fontsource-variable/lora"].map((specifier) =>
				readFontsource(specifier, from),
			),
		);
		return {
			compilerRoot: from,
			typeScriptEntries: resolveTypeScriptEntries(from),
			tsserverPath: resolveTypeScriptCompilerPath(from),
			uiSdkScanSources: await readScanSources(uiSdkRoot),
			fontAssets: fonts.flatMap(({ assets }) => assets),
			fontStylesheet: fonts.map(({ stylesheet }) => stylesheet).join("\n"),
			themeStylesheet: await Bun.file(
				Bun.resolveSync("@ryot-app/client-ui-sdk/theme.css", from),
			).text(),
			tailwindStylesheet: {
				path: tailwindEntry,
				content: await Bun.file(tailwindEntry).text(),
			},
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
