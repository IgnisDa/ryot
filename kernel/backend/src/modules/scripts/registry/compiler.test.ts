import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";

import { SandboxCompiler } from "./compiler";
import {
	compileSandboxSourceForTest as compile,
	validSandboxSource as validSource,
} from "./compiler.test-support";

const approvedDependencyImports = [
	"@ryot-app/plugin-backend-sdk/effect",
	"@ryot-app/plugin-backend-sdk/cheerio",
	"@ryot-app/plugin-backend-sdk/fflate",
	"@ryot-app/plugin-backend-sdk/youtubei",
	"@ryot-app/plugin-backend-sdk/papaparse",
	"@ryot-app/plugin-backend-sdk/fast-xml-parser",
] as const;

const automationSource = `
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";

export const manifest = defineManifest({
  kind: "automation",
  automationType: "automation",
  inputProjection: { signal: { properties: [] } },
  name: "Automation",
  slug: "automation.test",
});

export default defineAutomation({
  manifest,
  run: () => Effect.succeed(null),
});
`;

const workflowSource = `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/plugin-backend-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  name: "Workflow",
  slug: "workflow.test",
});

export default defineWorkflow({
  manifest,
  input: Schema.Struct({}),
  output: Schema.String,
  run: () => Effect.succeed("workflow"),
});
`;

layer(SandboxCompiler.layer)((test) => {
	test.effect("compiles one SDK script to an inline-source-mapped ESM module", () =>
		Effect.gen(function* () {
			const compiled = yield* compile(
				validSource.replace(
					"export default defineScript",
					'throw new Error("compilation must not execute source");\n\nexport default defineScript',
				),
			);

			expect(compiled.format).toBe(1);
			expect(compiled.manifest).toEqual({
				kind: "script",
				capabilities: [],
				name: "Plain value",
				slug: "plain-value",
				oauthConnectionFields: [],
				executableDependencies: [],
				requiredPluginConfigKeys: [],
				optionalPluginConfigKeys: [],
				runtimeImports: ["@ryot-app/plugin-backend-sdk/effect"],
			});
			expect(compiled.javascript).toContain("export {");
			expect(compiled.javascript).toContain("sourceMappingURL=data:application/json;base64,");
		}),
	);
});

layer(SandboxCompiler.layer)((test) => {
	test.effect("compiles a typed automation definition", () =>
		Effect.gen(function* () {
			const compiled = yield* compile(automationSource);

			expect(compiled.manifest.kind).toBe("automation");
			expect(compiled.manifest.slug).toBe("automation.test");
			expect(compiled.javascript).toContain("ryot:sandbox-script");
		}),
	);
});

layer(SandboxCompiler.layer)((test) => {
	test.effect("compiles a workflow definition through the compiler worker-facing API", () =>
		Effect.gen(function* () {
			const compiled = yield* compile(workflowSource);

			expect(compiled.manifest).toMatchObject({ kind: "workflow", slug: "workflow.test" });
			expect(compiled.javascript).toContain("sourceMappingURL=data:application/json;base64,");
		}),
	);
	test.effect.each(["Date.now()", "Math.random()"])(
		"rejects workflow nondeterminism through the worker-facing API: %s",
		(expression) =>
			Effect.gen(function* () {
				const failure = yield* compile(
					workflowSource.replace(
						'Effect.succeed("workflow")',
						`Effect.succeed(String(${expression}))`,
					),
				).pipe(Effect.flip);
				expect(failure.diagnostics).toEqual([
					expect.objectContaining({
						file: "script.ts",
						code: "RYOT_WORKFLOW_DETERMINISM",
						message: expect.stringContaining(expression.slice(0, -2)),
					}),
				]);
			}),
	);
});

layer(SandboxCompiler.layer)((test) => {
	test.effect("externalizes every approved SDK runtime dependency", () =>
		Effect.gen(function* () {
			const source = `${approvedDependencyImports.map((specifier) => `import "${specifier}";`).join("\n")}\n${validSource}`;
			const compiled = yield* compile(source);
			const emittedModule = compiled.javascript.split("//# sourceMappingURL", 1)[0] ?? "";

			for (const specifier of approvedDependencyImports) {
				expect(emittedModule).toContain(`"${specifier}"`);
			}
			expect(emittedModule).not.toMatch(
				/\b(?:from|import)\s*["'](?:cheerio|fast-xml-parser|fflate|papaparse|youtubei\.js|zod)(?:[/'"])/,
			);
			expect(new TextEncoder().encode(emittedModule).byteLength).toBeLessThan(128 * 1024);
		}),
	);
});

layer(SandboxCompiler.layer)((test) => {
	test.effect("returns an actionable TypeScript diagnostic", () =>
		Effect.gen(function* () {
			const failure = yield* compile(
				validSource.replace("Effect.succeed(input.value)", 'Effect.succeed("wrong")'),
			).pipe(Effect.flip);

			expect(failure._tag).toBe("SandboxCompilationFailure");
			expect(failure.diagnostics.length).toBeGreaterThan(0);
			expect(failure.diagnostics[0]).toMatchObject({ file: "script.ts", severity: "error" });
			expect(failure.diagnostics.some((diagnostic) => diagnostic.code.startsWith("TS"))).toBe(true);
		}),
	);
});

layer(SandboxCompiler.layer)((test) => {
	test.effect("rejects source-authored manifest capabilities", () =>
		Effect.gen(function* () {
			const failure = yield* compile(
				validSource.replace('kind: "script",', 'kind: "script",\n  capabilities: [],'),
			).pipe(Effect.flip);

			expect(failure.diagnostics).toEqual(
				expect.arrayContaining([expect.objectContaining({ code: "TS2322", severity: "error" })]),
			);
		}),
	);
});

layer(SandboxCompiler.layer)((test) => {
	test.effect("rejects direct package, runtime, URL, Node, Bun, and relative imports", () =>
		Effect.gen(function* () {
			for (const specifier of [
				"zod",
				"npm:zod@4.4.3",
				"deno:npm:zod@4.4.3",
				"@ryot-app/plugin-backend-sdk/testing",
				"https://example.com/module.ts",
				"node:fs",
				"bun:test",
				"./helper.ts",
			]) {
				const failure = yield* compile(`import "${specifier}";\n${validSource}`).pipe(Effect.flip);

				expect(failure.diagnostics).toEqual([
					expect.objectContaining({
						line: 1,
						code: "RYOT_IMPORT",
						message: expect.stringContaining(`Import "${specifier}" is not allowed`),
					}),
				]);
			}
		}),
	);
});

layer(SandboxCompiler.layer)((test) => {
	test.effect("rejects computed dynamic imports before resolution", () =>
		Effect.gen(function* () {
			const failure = yield* compile(
				`${validSource}\nconst dependency = "@ryot-app/plugin-backend-sdk/cheerio";\nvoid import(dependency);`,
			).pipe(Effect.flip);

			expect(failure.diagnostics).toEqual([
				expect.objectContaining({
					code: "RYOT_IMPORT",
					message: "Dynamic imports are not allowed",
				}),
			]);
		}),
	);
});

layer(SandboxCompiler.layer)((test) => {
	test.effect("rejects generated module loading and workers before bundling", () =>
		Effect.gen(function* () {
			for (const generatedModule of [
				"void Function('return import(\"npm:zod\")');",
				"void eval('require(\"node:fs\")');",
				'void new Worker("data:text/javascript,export default 1", { type: "module" });',
			]) {
				const failure = yield* compile(`${validSource}\n${generatedModule}`).pipe(Effect.flip);

				expect(failure.diagnostics).toEqual([
					expect.objectContaining({
						code: "RYOT_IMPORT",
						message: "Generated module loading and workers are not allowed",
					}),
				]);
			}
		}),
	);
});

layer(SandboxCompiler.layer)((test) => {
	test.effect("rejects CommonJS require before bundling", () =>
		Effect.gen(function* () {
			const failure = yield* compile(
				`${validSource}\ndeclare const require: (path: string) => unknown;\nrequire("./package.json");`,
			).pipe(Effect.flip);

			expect(failure.diagnostics).toEqual([
				expect.objectContaining({
					code: "RYOT_IMPORT",
					message: "CommonJS require calls are not allowed",
				}),
			]);
		}),
	);
});

layer(SandboxCompiler.layer)((test) => {
	test.effect("rejects a computed static manifest", () =>
		Effect.gen(function* () {
			const failure = yield* compile(
				validSource.replace('name: "Plain value"', 'name: ["Plain", "value"].join(" ")'),
			).pipe(Effect.flip);

			expect(failure.diagnostics).toEqual([
				expect.objectContaining({
					code: "RYOT_MANIFEST",
					message: "Manifest values must be JSON-safe literals",
				}),
			]);
		}),
	);
});
