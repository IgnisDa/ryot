import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { createTypeScriptProject, resolveTypeScriptCompilerPath } from "./index";
import { inspectTypeScriptReferences } from "./typescript-references";

const from = Bun.fileURLToPath(new URL(".", import.meta.url));

const parse = (source: string) =>
	createTypeScriptProject({
		projectKind: "test",
		entries: ["source.ts"],
		virtualRoot: "/__ryot_test__",
		files: { "source.ts": source },
		tsserverPath: resolveTypeScriptCompilerPath(from),
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
	}).pipe(
		Effect.flatMap(({ entrySourceFiles }) => {
			const file = entrySourceFiles["source.ts"];
			return file ? Effect.succeed(file) : Effect.die("TypeScript did not load source.ts");
		}),
	);

it.effect("reports every reference kind in document order with its node and specifier", () =>
	Effect.gen(function* () {
		const file = yield* parse(
			[
				'import value from "./value";',
				'export * from "./star";',
				"export { value };",
				'import required = require("./required");',
				"namespace Values { export const y = 1; }",
				"import alias = Values.y;",
				'declare module "virtual" { export * from "./nested"; import inner = require("./inner"); }',
				'type Loaded = typeof import("./typed");',
				"type Numeric = import(1);",
				'export const load = () => import("./lazy");',
				"export const computed = (name: string) => import(name);",
				'export const asset = new URL("./asset.svg", import.meta.url);',
				"export const dynamicAsset = (name: string) => new URL(name, import.meta.url);",
				"export const meta = import.meta;",
			].join("\n"),
		);

		expect(
			inspectTypeScriptReferences(file).map(({ kind, node, specifier, isTopLevel }) => ({
				kind,
				specifier,
				isTopLevel,
				text: node.getText(file),
			})),
		).toEqual([
			{
				isTopLevel: true,
				specifier: "./value",
				kind: "import-declaration",
				text: 'import value from "./value";',
			},
			{
				isTopLevel: true,
				specifier: "./star",
				kind: "export-declaration",
				text: 'export * from "./star";',
			},
			{
				isTopLevel: true,
				specifier: "./required",
				kind: "import-equals-require",
				text: 'import required = require("./required");',
			},
			{
				specifier: null,
				isTopLevel: true,
				kind: "import-equals-alias",
				text: "import alias = Values.y;",
			},
			{
				isTopLevel: false,
				specifier: "./nested",
				kind: "export-declaration",
				text: 'export * from "./nested";',
			},
			{
				isTopLevel: false,
				specifier: "./inner",
				kind: "import-equals-require",
				text: 'import inner = require("./inner");',
			},
			{
				isTopLevel: false,
				kind: "import-type",
				specifier: "./typed",
				text: 'typeof import("./typed")',
			},
			{ specifier: null, isTopLevel: false, text: "import(1)", kind: "import-type" },
			{ isTopLevel: false, specifier: "./lazy", kind: "dynamic-import", text: 'import("./lazy")' },
			{ specifier: null, isTopLevel: false, text: "import(name)", kind: "dynamic-import" },
			{
				isTopLevel: false,
				kind: "import-meta",
				specifier: "./asset.svg",
				text: 'new URL("./asset.svg", import.meta.url)',
			},
			{
				specifier: null,
				isTopLevel: false,
				kind: "import-meta",
				text: "new URL(name, import.meta.url)",
			},
			{ specifier: null, isTopLevel: false, kind: "import-meta", text: "import.meta" },
		]);
	}),
);

it.effect("returns the top-level declaration statements themselves", () =>
	Effect.gen(function* () {
		const file = yield* parse(
			'import value from "./value";\nexport * from "./star";\nimport alias = value.y;',
		);

		const nodes = inspectTypeScriptReferences(file).map(({ node }) => node);
		expect(nodes).toHaveLength(3);
		expect(nodes[0]).toBe(file.statements[0]);
		expect(nodes[1]).toBe(file.statements[1]);
		expect(nodes[2]).toBe(file.statements[2]);
	}),
);
