import { expect } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it, layer } from "@voila.dev/effect-bun-test";
import { Effect, FileSystem, Layer, Path } from "effect";

import {
	createTypeScriptProject,
	resolveTypeScriptCompilerPath,
	type TypeScriptCompilerDiagnostic,
	typeScriptProjectErrors,
	type TypeScriptProjectOptions,
	TypeScriptSession,
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

const project = (
	files: TypeScriptProjectOptions["files"],
	options: Partial<TypeScriptProjectOptions> = {},
) =>
	createTypeScriptProject({
		files,
		virtualRoot,
		projectKind: "test",
		entries: Object.keys(files),
		configuration: { compilerOptions },
		tsserverPath: resolveTypeScriptCompilerPath(from),
		...options,
	});

const errors = (
	files: TypeScriptProjectOptions["files"],
	options?: Partial<TypeScriptProjectOptions>,
) =>
	project(files, options).pipe(
		Effect.map(({ diagnostics }) => typeScriptProjectErrors(diagnostics, environmentFailure)),
	);

const codes = (diagnostics: readonly TypeScriptCompilerDiagnostic[]) =>
	diagnostics.map(({ code, file }) => `${file}:${code}`);

it("resolves the TypeScript 7 native compiler", () => {
	const path = resolveTypeScriptCompilerPath(from);
	expect(path).toMatch(/\/lib\/tsc(?:\.exe)?$/);
	expect(Bun.file(path).size).toBeGreaterThan(0);
});

layer(TypeScriptSession.layer)((test) => {
	test.effect(
		"collects project and source diagnostics and exposes entry source files",
		() =>
			Effect.gen(function* () {
				const result = yield* project({
					"semantic.ts": "const value: string = 1;",
					"syntactic.ts": "export const broken = ;",
				});

				expect(Object.keys(result.entrySourceFiles)).toEqual(["semantic.ts", "syntactic.ts"]);
				expect(result.sourceFiles).toHaveLength(2);
				expect(result.diagnostics.environment).toEqual([]);
				const diagnosticCodes = result.diagnostics.project.map(({ code }) => code);
				expect(diagnosticCodes.filter((code) => code === "TS2322")).toHaveLength(1);
				expect(diagnosticCodes.filter((code) => code === "TS1109")).toHaveLength(1);
			}),
		testTimeout,
	);

	test.effect(
		"normalizes project diagnostics with logical files and structural locations",
		() =>
			Effect.gen(function* () {
				expect(yield* errors({ "source.ts": "\nconst value: string = 1;" })).toEqual([
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

	test.effect(
		"rechecks changed, added, removed and re-rooted files across checks of one session",
		() =>
			Effect.gen(function* () {
				expect(codes(yield* errors({ "a.ts": "export const a: string = 1;" }))).toEqual([
					"a.ts:TS2322",
				]);
				expect(
					codes(
						yield* errors({
							"a.ts": 'export const a: string = "1";',
							"b.ts": 'import { a } from "./a";\nexport const b: number = a;',
						}),
					),
				).toEqual(["b.ts:TS2322"]);
				expect(yield* errors({ "a.ts": 'export const a: string = "1";' })).toEqual([]);
				expect(
					codes(
						yield* errors(
							{ "b.ts": 'import { a } from "./a";\nexport const b = a;' },
							{ virtualRoot: "/__ryot_other__" },
						),
					),
				).toEqual(["b.ts:TS2307"]);
			}),
		testTimeout,
	);
});

const dependencyProject = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-typescript-" });
	const dependency = path.join(directory, "dependency.ts");
	yield* fs.writeFileString(dependency, "\n\nexport const value: string = 1;\n");
	const diagnostics = yield* errors(
		{ "source.ts": 'import { value } from "dependency";\nexport const copy = value;' },
		{
			configuration: {
				compilerOptions: { ...compilerOptions, paths: { dependency: [dependency] } },
			},
		},
	);
	return { dependency, diagnostics };
});

layer(Layer.merge(BunServices.layer, TypeScriptSession.layer))((test) =>
	test.effect(
		"trusts resolved dependencies when checking projects",
		() =>
			Effect.gen(function* () {
				expect((yield* dependencyProject).diagnostics).toEqual([]);
			}),
		testTimeout,
	),
);

layer(Layer.merge(BunServices.layer, TypeScriptSession.environmentLayer))((test) =>
	test.effect(
		"verifies dependencies as environment errors located in their own files",
		() =>
			Effect.gen(function* () {
				const { dependency, diagnostics } = yield* dependencyProject;

				expect(diagnostics).toEqual([
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
