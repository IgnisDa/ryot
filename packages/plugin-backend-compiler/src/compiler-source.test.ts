import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { compileSandboxSource } from "./compiler-core";
import { pluginBackendCompilerPlatformLayer } from "./compiler-platform";
import { compilePluginSandboxSourceEntries } from "./compiler-plugins";

const ENTRY = "backend/entry.sandbox.ts";
const STANDALONE = "script.ts";
const disallowedSandboxImport = (specifier: string) =>
	`Import "${specifier}" is not allowed; use an approved @ryot-app/plugin-backend-sdk/core entry point`;
const disallowedSharedImport = (specifier: string) =>
	`Import "${specifier}" is not allowed; plugin shared sources may only import an approved @ryot-app/plugin-kit entry point or another shared source`;
const definitionCallMessage =
	"The default export must be a direct automation, operation, script, provider, or workflow definition call";
const workflowEffectMessage =
	"Workflow code must import deterministic Effect and Schema exports from @ryot-app/plugin-backend-sdk/workflow";

const scriptLines = [
	'import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";',
	'import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";',
	'export const manifest = defineManifest({ kind: "script", slug: "entry", name: "Entry" });',
	"export default defineScript({ manifest, input: Schema.Struct({}), output: Schema.Unknown, run: () => Effect.succeed(null) });",
];
const script = scriptLines.join("\n");

const at = (source: string, token: string, from = 0) => {
	const offset = source.indexOf(token, from);
	const before = source.slice(0, offset).split("\n");
	return { line: before.length, length: token.length, column: (before.at(-1) ?? "").length + 1 };
};

const diagnostic = (
	code: string,
	file: string,
	message: string,
	location: ReturnType<typeof at>,
) => ({ code, file, message, severity: "error", ...location });

const packageDiagnostics = (
	files: Readonly<Record<string, string>>,
	kind: "script" | "workflow" = "script",
) =>
	compilePluginSandboxSourceEntries(files, [{ kind, entry: ENTRY }]).pipe(
		Effect.flip,
		Effect.map(({ diagnostics }) => diagnostics),
	);

const bothPathDiagnostics = (source: string) =>
	Effect.gen(function* () {
		const standalone = yield* compileSandboxSource(source).pipe(Effect.flip);
		const packaged = yield* packageDiagnostics({ [ENTRY]: source });
		return { packaged, standalone: standalone.diagnostics };
	});

const sharedEntry = (specifier: string) =>
	[
		'import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";',
		'import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";',
		`import { label } from "${specifier}";`,
		'export const manifest = defineManifest({ kind: "script", slug: "entry", name: "Entry" });',
		"export default defineScript({ manifest, input: Schema.Struct({}), output: Schema.Unknown, run: () => Effect.succeed(label) });",
	].join("\n");

const importer = (specifier: string) =>
	`import { value } from "${specifier}";\nexport const label = value;`;

const sharedTargets = {
	"x.ts": 'export const value = "root-target";',
	"shared/x.ts": 'export const value = "shared-target";',
	"backend/x.ts": 'export const value = "backend-target";',
	"sharedx/y.ts": 'export const value = "sharedx-target";',
	"shared/index.ts": 'export const value = "shared-index-target";',
};

const workflowEntry = (specifier: string) =>
	[
		'import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/plugin-backend-sdk/workflow";',
		`import { label } from "${specifier}";`,
		'export const manifest = defineManifest({ kind: "workflow", slug: "flow", name: "Flow" });',
		"export default defineWorkflow({ manifest, input: Schema.Struct({}), output: Schema.String, run: () => Effect.succeed(typeof label) });",
	].join("\n");

const effectModule =
	'import { Effect } from "@ryot-app/plugin-backend-sdk/effect";\nexport const label = typeof Effect.void;';
const dateModule = "export const label = () => Date.now();";

it.layer(pluginBackendCompilerPlatformLayer)("sandbox source import policy", (test) => {
	test.effect.each([
		{
			label: "path",
			directive: '/// <reference path="./x.ts" />',
			message: "Reference directives are not allowed (./x.ts)",
		},
		{
			label: "types",
			directive: '/// <reference types="node" />',
			message: "Reference directives are not allowed (node)",
		},
		{
			label: "lib",
			directive: '/// <reference lib="es2015" />',
			message: "Reference directives are not allowed (es2015)",
		},
	])(
		"rejects a $label reference directive through source and package paths",
		({ message, directive }) =>
			Effect.gen(function* () {
				const source = `${directive}\n${script}`;
				const { packaged, standalone } = yield* bothPathDiagnostics(source);
				expect(standalone).toEqual([
					diagnostic("RYOT_IMPORT", STANDALONE, message, {
						line: 2,
						column: 1,
						length: script.length,
					}),
				]);
				expect(packaged).toEqual([
					diagnostic("RYOT_IMPORT", ENTRY, message, { line: 2, column: 1, length: script.length }),
				]);
			}),
	);

	test.effect.each([
		{
			token: 'import("zod").ZodType',
			label: "import type expression",
			prefix: 'type Loaded = import("zod").ZodType;',
			message: "Import type expressions are not allowed",
		},
		{
			label: "approved import type expression",
			message: "Import type expressions are not allowed",
			token: 'import("@ryot-app/plugin-backend-sdk/effect").Effect.Effect<void>',
			prefix: 'type Loaded = import("@ryot-app/plugin-backend-sdk/effect").Effect.Effect<void>;',
		},
		{
			label: "approved typeof import type expression",
			message: "Import type expressions are not allowed",
			token: 'typeof import("@ryot-app/plugin-backend-sdk/effect")',
			prefix: 'type Loaded = typeof import("@ryot-app/plugin-backend-sdk/effect");',
		},
		{
			label: "require import assignment",
			token: 'import zod = require("zod");',
			prefix: 'import zod = require("zod");',
			message: "Import assignments are not allowed",
		},
		{
			token: "import y = Values.y;",
			label: "alias import assignment",
			message: "Import assignments are not allowed",
			prefix: "namespace Values { export const y = 1; }\nimport y = Values.y;",
		},
		{
			label: "approved literal dynamic import",
			message: "Dynamic imports are not allowed",
			token: 'import("@ryot-app/plugin-backend-sdk/effect")',
			prefix: 'void import("@ryot-app/plugin-backend-sdk/effect");',
		},
		{
			token: '"zod"',
			label: "type-only import",
			message: disallowedSandboxImport("zod"),
			prefix: 'import type { ZodType } from "zod";',
		},
		{
			token: '"zod"',
			label: "star re-export",
			prefix: 'export * from "zod";',
			message: disallowedSandboxImport("zod"),
		},
		{
			token: '"zod"',
			label: "named re-export",
			prefix: 'export { z } from "zod";',
			message: disallowedSandboxImport("zod"),
		},
		{
			token: '"zod"',
			label: "type-only re-export",
			message: disallowedSandboxImport("zod"),
			prefix: 'export type { ZodType } from "zod";',
		},
		{
			token: '"zod"',
			label: "multiline import",
			prefix: 'import {\n\tz\n} from "zod";',
			message: disallowedSandboxImport("zod"),
		},
	])(
		"rejects one $label diagnostic through source and package paths",
		({ token, prefix, message }) =>
			Effect.gen(function* () {
				const source = `${prefix}\n${script}`;
				const { packaged, standalone } = yield* bothPathDiagnostics(source);
				expect(standalone).toEqual([
					diagnostic("RYOT_IMPORT", STANDALONE, message, at(source, token)),
				]);
				expect(packaged).toEqual([diagnostic("RYOT_IMPORT", ENTRY, message, at(source, token))]);
			}),
	);

	test.effect("reports several violations in one file in policy order", () =>
		Effect.gen(function* () {
			const rest = [
				'import type { ZodType } from "zod";',
				'type Loaded = import("@ryot-app/plugin-backend-sdk/effect").Effect.Effect<void>;',
				'import fs = require("node:fs");',
				'void import("@ryot-app/plugin-backend-sdk/effect");',
				'export * from "zod";',
				script,
			].join("\n");
			const source = `/// <reference lib="es2015" />\n${rest}`;
			const expected = (file: string) => [
				diagnostic("RYOT_IMPORT", file, "Reference directives are not allowed (es2015)", {
					line: 2,
					column: 1,
					length: rest.length,
				}),
				diagnostic("RYOT_IMPORT", file, disallowedSandboxImport("zod"), at(source, '"zod"')),
				diagnostic(
					"RYOT_IMPORT",
					file,
					"Import assignments are not allowed",
					at(source, 'import fs = require("node:fs");'),
				),
				diagnostic(
					"RYOT_IMPORT",
					file,
					disallowedSandboxImport("zod"),
					at(source, '"zod"', source.indexOf("export * from")),
				),
				diagnostic(
					"RYOT_IMPORT",
					file,
					"Import type expressions are not allowed",
					at(source, 'import("@ryot-app/plugin-backend-sdk/effect").Effect.Effect<void>'),
				),
				diagnostic(
					"RYOT_IMPORT",
					file,
					"Dynamic imports are not allowed",
					at(
						source,
						'import("@ryot-app/plugin-backend-sdk/effect")',
						source.indexOf("void import"),
					),
				),
			];
			const { packaged, standalone } = yield* bothPathDiagnostics(source);
			expect(standalone).toEqual(expected(STANDALONE));
			expect(packaged).toEqual(expected(ENTRY));
		}),
	);

	test.effect("reports only the inspection violation when the source also has a type error", () =>
		Effect.gen(function* () {
			const source = `import zod = require("zod");\nconst broken: string = 1;\n${script}`;
			const { packaged, standalone } = yield* bothPathDiagnostics(source);
			const location = at(source, 'import zod = require("zod");');
			expect(standalone).toEqual([
				diagnostic("RYOT_IMPORT", STANDALONE, "Import assignments are not allowed", location),
			]);
			expect(packaged).toEqual([
				diagnostic("RYOT_IMPORT", ENTRY, "Import assignments are not allowed", location),
			]);
		}),
	);

	test.effect("reports type errors before execution analysis errors on both paths", () =>
		Effect.gen(function* () {
			const runSync = 'Effect.runSync(Effect.succeed("ready"))';
			const executable = `${script}\nconst initialized = ${runSync};`;
			const executionOnly = yield* bothPathDiagnostics(executable);
			const executionError = (file: string) =>
				diagnostic(
					"RYOT_DEPENDENCY",
					file,
					"Effect execution during module initialization is unsupported",
					at(executable, runSync),
				);
			expect(executionOnly.standalone).toEqual([executionError(STANDALONE)]);
			expect(executionOnly.packaged).toEqual([executionError(ENTRY)]);

			const source = `${executable}\nconst broken: string = 1;`;
			const { packaged, standalone } = yield* bothPathDiagnostics(source);
			const typeError = (file: string) =>
				diagnostic(
					"TS2322",
					file,
					"Type 'number' is not assignable to type 'string'.",
					at(source, "broken"),
				);
			expect(standalone).toEqual([typeError(STANDALONE)]);
			expect(packaged).toEqual([typeError(ENTRY)]);
		}),
	);

	test.effect("rejects a provider operation given as a constant identifier", () =>
		Effect.gen(function* () {
			const definition =
				"{ manifest, operation: OP, run: () => Effect.succeed({ entities: [], continuation: null }) }";
			const source = [
				'import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";',
				'import { Effect } from "@ryot-app/plugin-backend-sdk/effect";',
				'import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";',
				'const OP = "related";',
				'export const manifest = defineManifest({ kind: "provider", name: "Provider", slug: "provider.related" });',
				`export default defineProvider(${definition});`,
			].join("\n");
			const failure = yield* compileSandboxSource(source).pipe(Effect.flip);
			expect(failure.diagnostics).toEqual([
				diagnostic(
					"RYOT_DEFINITION",
					STANDALONE,
					'The provider definition must contain the exported "manifest", a static standard operation, and a run function',
					at(source, definition),
				),
			]);
		}),
	);

	test.effect("rejects a definition whose manifest is another identifier", () =>
		Effect.gen(function* () {
			const definition =
				"{ manifest: other, input: Schema.Struct({}), output: Schema.Unknown, run: () => Effect.succeed(null) }";
			const source = [
				scriptLines[0],
				scriptLines[1],
				scriptLines[2],
				"const other = manifest;",
				`export default defineScript(${definition});`,
			].join("\n");
			const failure = yield* compileSandboxSource(source).pipe(Effect.flip);
			expect(failure.diagnostics).toEqual([
				diagnostic(
					"RYOT_DEFINITION",
					STANDALONE,
					'The script definition must contain the exported "manifest", input and output schemas, and a run function',
					at(source, definition),
				),
			]);
		}),
	);

	test.effect("rejects a source without a default export", () =>
		Effect.gen(function* () {
			const source = scriptLines.slice(0, 3).join("\n");
			const failure = yield* compileSandboxSource(source).pipe(Effect.flip);
			expect(failure.diagnostics).toEqual([
				diagnostic(
					"RYOT_DEFINITION",
					STANDALONE,
					"Source must have exactly one default definition export",
					at(source, source),
				),
			]);
		}),
	);

	test.effect("rejects a default export that is not a definition helper call", () =>
		Effect.gen(function* () {
			const assignment = "export default { manifest, run: () => Effect.succeed(null) };";
			const source = [...scriptLines.slice(0, 3), assignment].join("\n");
			const failure = yield* compileSandboxSource(source).pipe(Effect.flip);
			expect(failure.diagnostics).toEqual([
				diagnostic("RYOT_DEFINITION", STANDALONE, definitionCallMessage, at(source, assignment)),
			]);
		}),
	);

	test.effect("accepts import and require text inside comments and strings", () =>
		Effect.gen(function* () {
			const source = `// import("zod") require("x")\nconst inert = 'import("zod") require("x")';\n${script}`;
			const standalone = yield* compileSandboxSource(source);
			const packaged = yield* compilePluginSandboxSourceEntries({ [ENTRY]: source }, [
				{ entry: ENTRY, kind: "script" },
			]);
			expect(standalone.manifest.kind).toBe("script");
			expect(packaged[0]?.compiled.manifest.kind).toBe("script");
		}),
	);

	test.effect("checks only top-level declarations for module specifiers", () =>
		Effect.gen(function* () {
			const source = `declare module "x" { export * from "zod"; }\n${script}`;
			const { packaged, standalone } = yield* bothPathDiagnostics(source);
			for (const diagnostics of [standalone, packaged]) {
				expect(diagnostics.length).toBeGreaterThan(0);
				expect(diagnostics.every(({ code }) => code.startsWith("TS"))).toBe(true);
			}
		}),
	);

	test.effect("recognizes an aliased named definition helper import", () =>
		Effect.gen(function* () {
			const source = script
				.replace("defineScript }", "defineScript as ds }")
				.replace("export default defineScript(", "export default ds(");
			const standalone = yield* compileSandboxSource(source);
			const packaged = yield* compilePluginSandboxSourceEntries({ [ENTRY]: source }, [
				{ entry: ENTRY, kind: "script" },
			]);
			expect(standalone.manifest.kind).toBe("script");
			expect(packaged[0]?.compiled.manifest.kind).toBe("script");
		}),
	);

	test.effect.each([
		{
			label: "re-exported",
			token: scriptLines[3] ?? "",
			source: [
				'import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";',
				'import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";',
				'export { defineScript } from "@ryot-app/plugin-backend-sdk/driver";',
				scriptLines[2],
				scriptLines[3],
			].join("\n"),
		},
		{
			label: "namespace-imported",
			token: (scriptLines[3] ?? "").replace("defineScript(", "sdk.defineScript("),
			source: [
				'import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";',
				'import * as sdk from "@ryot-app/plugin-backend-sdk/driver";',
				'import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";',
				scriptLines[2],
				(scriptLines[3] ?? "").replace("defineScript(", "sdk.defineScript("),
			].join("\n"),
		},
	])("does not recognize a $label definition helper", ({ token, source }) =>
		Effect.gen(function* () {
			const diagnostics = yield* packageDiagnostics({ [ENTRY]: source });
			expect(diagnostics).toEqual([
				diagnostic("RYOT_DEFINITION", ENTRY, definitionCallMessage, at(source, token)),
			]);
		}),
	);

	test.effect.each([
		{ specifier: "./x", entryImport: "../shared/a", importerPath: "shared/a.ts" },
		{ specifier: "../shared/x", entryImport: "../shared/a", importerPath: "shared/a.ts" },
		{ specifier: "../x", entryImport: "../shared/sub/a", importerPath: "shared/sub/a.ts" },
	])(
		"accepts $specifier from $importerPath inside the shared root",
		({ specifier, entryImport, importerPath }) =>
			Effect.gen(function* () {
				const compiled = yield* compilePluginSandboxSourceEntries(
					{
						...sharedTargets,
						[ENTRY]: sharedEntry(entryImport),
						[importerPath]: importer(specifier),
					},
					[{ entry: ENTRY, kind: "script" }],
				);
				expect(compiled[0]?.compiled.javascript).toContain("shared-target");
			}),
	);

	test.effect.each([
		{ entryImport: "../shared/a", specifier: "..//backend/x", importerPath: "shared/a.ts" },
		{ specifier: "../sharedx/y", entryImport: "../shared/a", importerPath: "shared/a.ts" },
		{ specifier: ".", entryImport: "../shared/a", importerPath: "shared/a.ts" },
		{ specifier: "./", entryImport: "../shared/a", importerPath: "shared/a.ts" },
		{ specifier: "../../x", entryImport: "../shared/sub/a", importerPath: "shared/sub/a.ts" },
	])(
		"rejects $specifier from $importerPath outside the shared root",
		({ specifier, entryImport, importerPath }) =>
			Effect.gen(function* () {
				const source = importer(specifier);
				const diagnostics = yield* packageDiagnostics({
					...sharedTargets,
					[importerPath]: source,
					[ENTRY]: sharedEntry(entryImport),
				});
				expect(diagnostics).toEqual([
					diagnostic(
						"RYOT_IMPORT",
						importerPath,
						disallowedSharedImport(specifier),
						at(source, `"${specifier}"`),
					),
				]);
			}),
	);

	test.effect.each([
		{ entryImport: "../shared/a", importerPath: "shared/a.ts", specifier: "../../shared/x" },
		{ entryImport: "./a", specifier: "../../x", importerPath: "backend/a.ts" },
	])(
		"reports $specifier from $importerPath outside the virtual root as unresolved",
		({ specifier, entryImport, importerPath }) =>
			Effect.gen(function* () {
				const source = importer(specifier);
				const diagnostics = yield* packageDiagnostics({
					...sharedTargets,
					[importerPath]: source,
					[ENTRY]: sharedEntry(entryImport),
				});
				expect(diagnostics).toEqual([
					diagnostic(
						"TS2307",
						importerPath,
						`Cannot find module '${specifier}' or its corresponding type declarations.`,
						at(source, `"${specifier}"`),
					),
				]);
			}),
	);

	test.effect.each([
		{
			specifier: "./lib/x.js",
			reached: "backend/lib/x.ts",
			label: "a JavaScript-extension import",
			modules: { "backend/lib/x.ts": effectModule },
		},
		{
			specifier: "./lib",
			reached: "backend/lib.ts",
			label: "an extensionless import",
			modules: { "backend/lib.ts": effectModule },
		},
		{
			specifier: "./barrel",
			reached: "backend/lib/x.ts",
			label: "a star re-export chain",
			modules: {
				"backend/lib/x.ts": effectModule,
				"backend/barrel.ts": 'export * from "./lib/x";',
			},
		},
	])(
		"rejects unrestricted Effect in a backend module reached through $label",
		({ modules, reached, specifier }) =>
			Effect.gen(function* () {
				const diagnostics = yield* packageDiagnostics(
					{ ...modules, [ENTRY]: workflowEntry(specifier) },
					"workflow",
				);
				expect(diagnostics).toEqual([
					diagnostic(
						"RYOT_WORKFLOW_DETERMINISM",
						reached,
						workflowEffectMessage,
						at(effectModule, '"@ryot-app/plugin-backend-sdk/effect"'),
					),
				]);
			}),
	);

	test.effect.each([
		{
			specifier: "../shared/x",
			label: "a direct shared import",
			modules: { "shared/x.ts": dateModule },
		},
		{
			specifier: "../shared/a",
			label: "another shared module",
			modules: { "shared/x.ts": dateModule, "shared/a.ts": 'export { label } from "./x";' },
		},
	])(
		"rejects ambient nondeterminism in a shared module reached through $label",
		({ modules, specifier }) =>
			Effect.gen(function* () {
				const diagnostics = yield* packageDiagnostics(
					{ ...modules, [ENTRY]: workflowEntry(specifier) },
					"workflow",
				);
				expect(diagnostics).toEqual([
					diagnostic(
						"RYOT_WORKFLOW_DETERMINISM",
						"shared/x.ts",
						"Workflow code cannot use ambient nondeterminism: Date.now",
						at(dateModule, "Date.now()"),
					),
				]);
			}),
	);
});
