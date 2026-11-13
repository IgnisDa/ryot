import { expect } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, FileSystem, Path } from "effect";

import {
	createTypeScriptProject,
	resolveTypeScriptCompilerPath,
	type TypeScriptCompilerDiagnostic,
	typeScriptProjectErrors,
} from "./index";

const virtualRoot = "/__ryot_test__";
const from = Bun.fileURLToPath(new URL(".", import.meta.url));
const compilerOptions = {
	types: [],
	strict: true,
	noEmit: true,
	lib: ["ES2022"],
	target: "ES2022",
	module: "ESNext",
};
const environmentFailure: TypeScriptCompilerDiagnostic = {
	line: 1,
	column: 1,
	file: "project",
	severity: "error",
	code: "ENVIRONMENT",
	message: "Dependencies failed type checking",
};

it("resolves the TypeScript 7 native compiler", () => {
	const path = resolveTypeScriptCompilerPath(from);
	expect(path).toMatch(/\/lib\/tsc(?:\.exe)?$/);
	expect(Bun.file(path).size).toBeGreaterThan(0);
});

it.effect(
	"collects project and source diagnostics and exposes entry source files",
	() =>
		Effect.gen(function* () {
			const project = yield* createTypeScriptProject({
				virtualRoot,
				projectKind: "test",
				configuration: { compilerOptions },
				entries: ["semantic.ts", "syntactic.ts"],
				tsserverPath: resolveTypeScriptCompilerPath(from),
				files: {
					"semantic.ts": "const value: string = 1;",
					"syntactic.ts": "export const broken = ;",
				},
			});

			expect(Object.keys(project.entrySourceFiles)).toEqual(["semantic.ts", "syntactic.ts"]);
			expect(project.sourceFiles).toHaveLength(2);
			expect(project.diagnostics.environment).toEqual([]);
			const diagnosticCodes = project.diagnostics.project.map(({ code }) => code);
			expect(diagnosticCodes.filter((code) => code === "TS2322")).toHaveLength(1);
			expect(diagnosticCodes.filter((code) => code === "TS1109")).toHaveLength(1);
		}),
	testTimeout,
);

it.effect(
	"normalizes project diagnostics with logical files and structural locations",
	() =>
		Effect.gen(function* () {
			const project = yield* createTypeScriptProject({
				virtualRoot,
				projectKind: "test",
				entries: ["source.ts"],
				configuration: { compilerOptions },
				tsserverPath: resolveTypeScriptCompilerPath(from),
				files: { "source.ts": "\nconst value: string = 1;" },
			});

			expect(typeScriptProjectErrors(project.diagnostics, environmentFailure)).toEqual([
				{
					line: 2,
					column: 7,
					length: 5,
					code: "TS2322",
					file: "source.ts",
					severity: "error",
					message: "Type 'number' is not assignable to type 'string'.",
				},
			]);
		}),
	testTimeout,
);

it.layer(BunServices.layer)("dependency diagnostics", (test) =>
	test.effect(
		"locates dependency diagnostics in their own files and reports them as environment errors",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-typescript-" });
				const dependency = path.join(directory, "dependency.ts");
				yield* fs.writeFileString(dependency, "\n\nexport const value: string = 1;\n");
				const project = yield* createTypeScriptProject({
					virtualRoot,
					projectKind: "test",
					entries: ["source.ts"],
					tsserverPath: resolveTypeScriptCompilerPath(from),
					files: { "source.ts": 'import { value } from "dependency";\nexport const copy = value;' },
					configuration: {
						compilerOptions: { ...compilerOptions, paths: { dependency: [dependency] } },
					},
				});

				expect(project.diagnostics.project).toEqual([]);
				expect(typeScriptProjectErrors(project.diagnostics, environmentFailure)).toEqual([
					environmentFailure,
					{
						line: 3,
						length: 5,
						column: 14,
						code: "TS2322",
						file: dependency,
						severity: "error",
						message: "Type 'number' is not assignable to type 'string'.",
					},
				]);
			}),
		testTimeout,
	),
);
