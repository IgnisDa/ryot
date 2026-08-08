import { sortBy } from "@ryot/ts-utils/lodash";
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
	"@ryot/client-sdk",
	"@ryot/client-sdk/effect",
	"@ryot/client-sdk/plugin",
	"@ryot/client-sdk/react",
	"@ryot/client-sdk/ryotql",
	"@ryot/client-ui-sdk",
]);

export const isTrustedClientModule = (specifier: string) => TRUSTED_MODULES.has(specifier);

const directoryOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

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
		const uiSdkRoot = directoryOf(Bun.resolveSync("@ryot/client-ui-sdk", from));
		const tailwindEntry = Bun.resolveSync("tailwindcss/index.css", from);
		const fonts = await Promise.all(
			["@fontsource-variable/outfit", "@fontsource-variable/lora"].map((specifier) =>
				readFontsource(specifier, from),
			),
		);
		return {
			compilerRoot: from,
			fontAssets: fonts.flatMap(({ assets }) => assets),
			fontStylesheet: fonts.map(({ stylesheet }) => stylesheet).join("\n"),
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
