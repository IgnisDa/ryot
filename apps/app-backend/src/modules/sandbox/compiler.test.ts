import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { SandboxCompiler } from "./compiler";

const validSource = `
import { defineDriver, defineManifest, defineScript, z } from "@ryot/sandbox-sdk";

export const manifest = defineManifest({
  kind: "script",
  name: "Plain value",
  slug: "plain-value",
  capabilities: [],
  requiredAppConfigKeys: [],
});

const main = defineDriver(manifest, {
  input: z.object({ value: z.number() }),
  output: z.number(),
  run: async (input) => input.value,
});

export default defineScript({ manifest, drivers: { main } });
`;

const compile = (source: string) =>
	Effect.gen(function* () {
		const compiler = yield* SandboxCompiler;
		return yield* compiler.compile(source);
	}).pipe(Effect.provide(SandboxCompiler.Default));

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
			requiredAppConfigKeys: [],
		});
		expect(compiled.javascript).toContain("export {");
		expect(compiled.javascript).toContain("sourceMappingURL=data:application/json;base64,");
	}),
);

it.effect("returns an actionable TypeScript diagnostic", () =>
	Effect.gen(function* () {
		const failure = yield* compile(validSource.replace("input.value,", '"wrong",')).pipe(
			Effect.flip,
		);

		expect(failure._tag).toBe("SandboxCompilationFailure");
		expect(failure.diagnostics.length).toBeGreaterThan(0);
		expect(failure.diagnostics[0]).toMatchObject({
			file: "script.ts",
			severity: "error",
		});
		expect(failure.diagnostics.some((diagnostic) => diagnostic.code.startsWith("TS"))).toBe(true);
	}),
);

it.effect("rejects imports outside the SDK before resolution", () =>
	Effect.gen(function* () {
		const failure = yield* compile(`import "node:fs";\n${validSource}`).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				line: 1,
				code: "RYOT_IMPORT",
				message: expect.stringContaining('Import "node:fs" is not allowed'),
			}),
		]);
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
