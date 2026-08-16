import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
	compileSandboxSourceForTest as compile,
	validSandboxSource as validSource,
} from "./compiler-test-support";

const approvedDependencyImports = [
	"@ryot/sandbox-sdk/effect",
	"@ryot/sandbox-sdk/cheerio",
	"@ryot/sandbox-sdk/fflate",
	"@ryot/sandbox-sdk/youtubei",
	"@ryot/sandbox-sdk/papaparse",
	"@ryot/sandbox-sdk/fast-xml-parser",
] as const;

const automationSource = `
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineAutomation } from "@ryot/sandbox-sdk/automation";

export const manifest = defineManifest({
  kind: "automation",
  name: "Automation",
  slug: "automation.test",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineAutomation({
  manifest,
  run: () => Effect.succeed(null),
});
`;

it.effect("compiles one SDK script to an inline-source-mapped ESM module", () =>
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
			requiredPluginConfigKeys: [],
			requiredSystemConfigKeys: [],
		});
		expect(compiled.javascript).toContain("export {");
		expect(compiled.javascript).toContain("sourceMappingURL=data:application/json;base64,");
	}),
);

it.effect("compiles a typed automation definition", () =>
	Effect.gen(function* () {
		const compiled = yield* compile(automationSource);

		expect(compiled.manifest.kind).toBe("automation");
		expect(compiled.manifest.slug).toBe("automation.test");
		expect(compiled.javascript).toContain("ryot:sandbox-script");
	}),
);

it.effect("externalizes every approved SDK runtime dependency", () =>
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

it.effect("returns an actionable TypeScript diagnostic", () =>
	Effect.gen(function* () {
		const failure = yield* compile(
			validSource.replace("Effect.succeed(input.value)", 'Effect.succeed("wrong")'),
		).pipe(Effect.flip);

		expect(failure._tag).toBe("SandboxCompilationFailure");
		expect(failure.diagnostics.length).toBeGreaterThan(0);
		expect(failure.diagnostics[0]).toMatchObject({
			file: "script.ts",
			severity: "error",
		});
		expect(failure.diagnostics.some((diagnostic) => diagnostic.code.startsWith("TS"))).toBe(true);
	}),
);

it.effect("types a host method declared by the manifest capability tuple", () =>
	Effect.gen(function* () {
		const compiled = yield* compile(
			validSource.replace("capabilities: []", 'capabilities: ["getCachedValue"]').replace(
				"run: (input) => Effect.succeed(input.value),",
				`run: (input, host) => Effect.gen(function* () {
    const cached = yield* host.getCachedValue("answer");
    return typeof cached === "number" ? cached : input.value;
  }),`,
			),
		);

		expect(compiled.manifest.capabilities).toEqual(["getCachedValue"]);
	}),
);

it.effect("rejects a host method omitted from the manifest capability tuple", () =>
	Effect.gen(function* () {
		const failure = yield* compile(
			validSource.replace(
				"run: (input) => Effect.succeed(input.value),",
				`run: (input, host) => Effect.gen(function* () {
    yield* host.getCachedValue("answer");
    return input.value;
  }),`,
			),
		).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "TS2339",
					severity: "error",
					message: expect.stringContaining("getCachedValue"),
				}),
			]),
		);
	}),
);

it.effect("rejects direct package, runtime, URL, Node, Bun, and relative imports", () =>
	Effect.gen(function* () {
		for (const specifier of [
			"zod",
			"npm:zod@4.4.3",
			"deno:npm:zod@4.4.3",
			"@ryot/sandbox-sdk/testing",
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

it.effect("rejects computed dynamic imports before resolution", () =>
	Effect.gen(function* () {
		const failure = yield* compile(
			`${validSource}\nconst dependency = "@ryot/sandbox-sdk/cheerio";\nvoid import(dependency);`,
		).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_IMPORT",
				message: "Dynamic imports are not allowed",
			}),
		]);
	}),
);

it.effect("rejects generated module loading and workers before bundling", () =>
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

it.effect("rejects CommonJS require before bundling", () =>
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

it.effect("rejects a computed static manifest", () =>
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
