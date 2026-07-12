import {
	createTypeScriptProject,
	normalizeTypeScriptDiagnostic,
	type TypeScriptProjectConfiguration,
} from "@ryot-app/typescript-compiler";
import { Effect } from "effect";

import type { ClientPluginCompilerDiagnostic } from "./diagnostics";

const VIRTUAL_ROOT = "/__ryot_client__";
const AMBIENT_FILE = "__ryot_client_imports__.d.ts";
const TEST_SOURCE = /\.(?:test|spec)\.tsx?$/;
const TYPESCRIPT_SOURCE = /\.tsx?$/;
const ambientSource = `
interface ImportMeta { readonly env: Readonly<Record<string, string | undefined>>; }
declare module "*.css" {}
declare module "*.svg" { const value: string; export default value; }
declare module "*.png" { const value: string; export default value; }
declare module "*.jpg" { const value: string; export default value; }
declare module "*.jpeg" { const value: string; export default value; }
declare module "*.gif" { const value: string; export default value; }
declare module "*.webp" { const value: string; export default value; }
declare module "*.avif" { const value: string; export default value; }
declare module "*.ico" { const value: string; export default value; }
declare module "*.woff2" { const value: string; export default value; }
declare module "*.wasm" { const value: string; export default value; }
`;

export const clientTypeScriptProject = {
	compilerOptions: {
		types: [],
		strict: true,
		noEmit: true,
		jsx: "react-jsx",
		target: "ES2022",
		module: "ESNext",
		skipLibCheck: false,
		isolatedModules: true,
		noImplicitReturns: true,
		moduleDetection: "force",
		verbatimModuleSyntax: true,
		moduleResolution: "bundler",
		noUncheckedIndexedAccess: true,
		exactOptionalPropertyTypes: true,
		allowSyntheticDefaultImports: true,
		lib: ["ES2022", "ESNext.Disposable", "DOM", "DOM.Iterable"],
	},
} satisfies TypeScriptProjectConfiguration;

const logicalFile = (fileName: string) =>
	fileName.startsWith(`${VIRTUAL_ROOT}/`) ? fileName.slice(VIRTUAL_ROOT.length + 1) : fileName;

export type ClientTypeScriptDependencies = {
	readonly tsserverPath: string;
	readonly typeScriptEntries: Readonly<Record<string, string>>;
};

export const analyzeClientPluginTypes = (
	files: Readonly<Record<string, string>>,
	dependencies: ClientTypeScriptDependencies,
	virtualEntries: Readonly<Record<string, string>> = {},
	selectedEntries?: readonly string[],
) => {
	const entries =
		selectedEntries ??
		Object.keys(files).filter((path) => TYPESCRIPT_SOURCE.test(path) && !TEST_SOURCE.test(path));
	return createTypeScriptProject({
		virtualRoot: VIRTUAL_ROOT,
		projectKind: "client plugin",
		entries: [...entries, AMBIENT_FILE],
		tsserverPath: dependencies.tsserverPath,
		files: { ...files, [AMBIENT_FILE]: ambientSource },
		configuration: {
			...clientTypeScriptProject,
			compilerOptions: {
				...clientTypeScriptProject.compilerOptions,
				paths: Object.fromEntries(
					Object.entries({ ...dependencies.typeScriptEntries, ...virtualEntries }).map(
						([specifier, entry]) => [
							specifier,
							[entry.startsWith("/") ? entry : `${VIRTUAL_ROOT}/${entry}`],
						],
					),
				),
			},
		},
	}).pipe(
		Effect.map(({ diagnostics, sourceFiles, entrySourceFiles }) => {
			const fallbackFile = entrySourceFiles[entries[0] ?? AMBIENT_FILE];
			if (!fallbackFile) {
				return { sources: [], diagnostics: [] };
			}
			return {
				sources: sourceFiles
					.map(({ fileName }) => logicalFile(fileName))
					.filter((path) => Object.hasOwn(files, path)),
				diagnostics: diagnostics
					.map(
						(diagnostic): ClientPluginCompilerDiagnostic =>
							normalizeTypeScriptDiagnostic(diagnostic, sourceFiles, fallbackFile, logicalFile),
					)
					.filter((diagnostic) => diagnostic.severity === "error"),
			};
		}),
	);
};
