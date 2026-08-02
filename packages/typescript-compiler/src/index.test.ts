import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { DiagnosticCategory } from "typescript/unstable/async";

import {
	createTypeScriptProject,
	normalizeTypeScriptDiagnostic,
	resolveTypeScriptCompilerPath,
} from "./index";

const virtualRoot = "/__ryot_test__";
const logicalFile = (fileName: string) => fileName.slice(`${virtualRoot}/`.length);
const from = Bun.fileURLToPath(new URL(".", import.meta.url));

it("resolves the TypeScript 7 native compiler", () => {
	const path = resolveTypeScriptCompilerPath(from);
	expect(path).toMatch(/\/lib\/tsc(?:\.exe)?$/);
	expect(Bun.file(path).size).toBeGreaterThan(0);
});

it.effect("collects project and source diagnostics and exposes entry source files", () =>
	Effect.gen(function* () {
		const project = yield* createTypeScriptProject({
			virtualRoot,
			projectKind: "test",
			entries: ["semantic.ts", "syntactic.ts"],
			tsserverPath: resolveTypeScriptCompilerPath(from),
			files: {
				"semantic.ts": "const value: string = 1;",
				"syntactic.ts": "export const broken = ;",
			},
			configuration: {
				compilerOptions: {
					types: [],
					strict: true,
					noEmit: true,
					lib: ["ES2022"],
					target: "ES2022",
					module: "ESNext",
				},
			},
		});

		expect(Object.keys(project.entrySourceFiles)).toEqual(["semantic.ts", "syntactic.ts"]);
		expect(project.sourceFiles).toHaveLength(2);
		expect(project.diagnostics.map(({ code }) => code)).toEqual(
			expect.arrayContaining([2322, 1109]),
		);
	}),
);

it.effect("normalizes diagnostics with logical files and structural locations", () =>
	Effect.gen(function* () {
		const project = yield* createTypeScriptProject({
			virtualRoot,
			projectKind: "test",
			entries: ["source.ts"],
			tsserverPath: resolveTypeScriptCompilerPath(from),
			files: { "source.ts": "\nconst value: string = 1;" },
			configuration: {
				compilerOptions: {
					types: [],
					strict: true,
					noEmit: true,
					lib: ["ES2022"],
					target: "ES2022",
					module: "ESNext",
				},
			},
		});
		const diagnostic = project.diagnostics.find(
			({ code, category }) => category === DiagnosticCategory.Error && code === 2322,
		);
		const sourceFile = project.entrySourceFiles["source.ts"];
		expect(diagnostic).toBeDefined();
		expect(sourceFile).toBeDefined();
		if (!diagnostic || !sourceFile) {
			return;
		}

		expect(
			normalizeTypeScriptDiagnostic(diagnostic, project.sourceFiles, sourceFile, logicalFile),
		).toEqual({
			line: 2,
			column: 7,
			length: 5,
			code: "TS2322",
			file: "source.ts",
			severity: "error",
			message: "Type 'number' is not assignable to type 'string'.",
		});
	}),
);
