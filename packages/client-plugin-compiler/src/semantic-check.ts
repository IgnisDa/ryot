import { createTypeScriptProject, normalizeTypeScriptDiagnostic } from "@ryot/typescript-compiler";
import { Effect } from "effect";

import type { ClientPluginCompilerDiagnostic } from "./diagnostics";

const VIRTUAL_ROOT = "/__ryot_client__";
const AMBIENT_FILE = "__ryot_client_imports__.d.ts";
const TEST_SOURCE = /\.(?:test|spec)\.tsx?$/;
const TYPESCRIPT_SOURCE = /\.tsx?$/;
const ambientSource = `
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

const logicalFile = (fileName: string) =>
	fileName.startsWith(`${VIRTUAL_ROOT}/`) ? fileName.slice(VIRTUAL_ROOT.length + 1) : fileName;

export type ClientTypeScriptDependencies = {
	readonly tsserverPath: string;
	readonly typeScriptEntries: Readonly<Record<string, string>>;
};

export const checkClientPluginTypes = (
	files: Readonly<Record<string, string>>,
	dependencies: ClientTypeScriptDependencies,
) => {
	const entries = Object.keys(files).filter(
		(path) => TYPESCRIPT_SOURCE.test(path) && !TEST_SOURCE.test(path),
	);
	return createTypeScriptProject({
		entries: [...entries, AMBIENT_FILE],
		projectKind: "client plugin",
		tsserverPath: dependencies.tsserverPath,
		virtualRoot: VIRTUAL_ROOT,
		files: { ...files, [AMBIENT_FILE]: ambientSource },
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
			lib: ["ES2022", "DOM", "DOM.Iterable"],
			paths: Object.fromEntries(
				Object.entries(dependencies.typeScriptEntries).map(([specifier, entry]) => [
					specifier,
					[entry],
				]),
			),
		},
	}).pipe(
		Effect.map(({ diagnostics, entrySourceFiles, sourceFiles }) => {
			const fallbackFile = entrySourceFiles[entries[0] ?? AMBIENT_FILE];
			if (!fallbackFile) {
				return [];
			}
			return diagnostics
				.map(
					(diagnostic): ClientPluginCompilerDiagnostic =>
						normalizeTypeScriptDiagnostic(diagnostic, sourceFiles, fallbackFile, logicalFile),
				)
				.filter((diagnostic) => diagnostic.severity === "error");
		}),
	);
};
