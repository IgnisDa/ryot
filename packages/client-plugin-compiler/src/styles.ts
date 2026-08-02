import { sortBy } from "@ryot/ts-utils/lodash";
import { Scanner } from "@tailwindcss/oxide";
import { Effect } from "effect";
import { compile } from "tailwindcss";

import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";
import { CLIENT_THEME_CSS } from "./theme";

type ScanSource = { readonly content: string; readonly extension: string };

const directoryOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

const loadStylesheet = async (id: string, base: string, tailwindEntry: string) => {
	const path = id === "tailwindcss" ? tailwindEntry : Bun.resolveSync(id, base);
	return { path, base: directoryOf(path), content: await Bun.file(path).text() };
};

export const compileClientStyles = (
	stylesheet: string,
	scanSources: readonly ScanSource[],
	tailwindEntry: string,
	entry: string,
) =>
	Effect.tryPromise({
		try: async () => {
			const compiled = await compile(`${stylesheet}\n${CLIENT_THEME_CSS}`, {
				base: directoryOf(tailwindEntry),
				loadStylesheet: (id, base) => loadStylesheet(id, base, tailwindEntry),
			});
			const candidates = new Scanner({}).scanFiles([...scanSources]);
			return compiled.build(sortBy(candidates));
		},
		catch: (error) =>
			clientPluginCompilationFailure([
				clientPluginCompilerDiagnostic(
					"RYOT_CLIENT_STYLES",
					entry,
					`Client plugin stylesheet could not be compiled: ${String(error)}`,
				),
			]),
	});
