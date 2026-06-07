import { sortBy } from "@ryot/ts-utils/lodash";
import { Scanner } from "@tailwindcss/oxide";
import { Effect } from "effect";
import { compile } from "tailwindcss";

import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";

type ScanSource = { readonly content: string; readonly extension: string };
type StylesheetSource = { readonly content: string; readonly path: string };

type CompileClientStylesInput = {
	readonly entry: string;
	readonly themeStylesheet: string;
	readonly scanSources: readonly ScanSource[];
	readonly tailwindStylesheet: StylesheetSource;
	readonly files: Readonly<Record<string, string>>;
	readonly stylesheet: StylesheetSource | undefined;
};

const directoryOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

const resolveClientStylesheet = (
	id: string,
	base: string,
	files: Readonly<Record<string, string>>,
) => {
	if (!/^\.{1,2}\//.test(id)) {
		return null;
	}

	const parts = base.split("/").filter(Boolean);
	for (const part of id.split("/")) {
		if (!part || part === ".") {
			continue;
		}
		if (part === "..") {
			if (parts.length === 0) {
				return null;
			}
			parts.pop();
			continue;
		}
		parts.push(part);
	}

	const path = parts.join("/");
	return path.startsWith("client/") && path.endsWith(".css") && Object.hasOwn(files, path)
		? path
		: null;
};

export const compileClientStyles = ({
	entry,
	files,
	stylesheet,
	scanSources,
	themeStylesheet,
	tailwindStylesheet,
}: CompileClientStylesInput) =>
	Effect.tryPromise({
		try: async () => {
			const compiled = await compile(`${stylesheet?.content ?? ""}\n${themeStylesheet}`, {
				base: stylesheet === undefined ? "client" : directoryOf(stylesheet.path),
				loadStylesheet: (id, base) =>
					Promise.resolve().then(() => {
						if (id === "tailwindcss") {
							return { ...tailwindStylesheet, base: directoryOf(tailwindStylesheet.path) };
						}

						const path = resolveClientStylesheet(id, base, files);
						if (path === null) {
							throw new Error(
								`Stylesheet import "${id}" from "${base}" is not allowed; client plugins may only import "tailwindcss" and relative CSS files from client sources`,
							);
						}
						return { path, base: directoryOf(path), content: files[path] ?? "" };
					}),
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
