import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import jscodeshift from "jscodeshift";

import { formatViolation, scanSource } from "./guard";
import transform from "./transforms/bun-services";

const fixtures = join(import.meta.dir, "fixtures/bun-services");
const j = jscodeshift.withParser("tsx");

const readFixture = (name: string) => Bun.file(join(fixtures, name)).text();

const runTransform = (source: string, path = "apps/app-backend/src/fixture.ts") => {
	const reports: string[] = [];
	const output = transform(
		{ path, source },
		{ jscodeshift: j, report: (message: string) => reports.push(message) },
	);
	return { output, reports };
};

describe("Bun services", () => {
	for (const [name, references] of [
		["direct", 2],
		["alias", 0],
		["collision", 0],
	] as const) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input);

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual([
				`[bun-services] transformed apps/app-backend/src/fixture.ts (1 import binding, ${references} references)`,
			]);
			expect(runTransform(first.output ?? input)).toEqual({ output: undefined, reports: [] });
			expect(await scanSource(`fixture/${name}.ts`, expected)).toEqual([]);
		});
	}

	test("rejects every unsupported direct-binding context transactionally", async () => {
		const input = await readFixture("unsupported-references.input.tsx");
		expect(runTransform(input)).toEqual({
			output: await readFixture("unsupported-references.output.tsx"),
			reports: [
				"[bun-services] warning: skipped apps/app-backend/src/fixture.ts: unsupported BunContext reference",
			],
		});
	});

	test("rejects each unsupported direct-binding context independently", () => {
		for (const reference of [
			"type T = BunContext;",
			"type T = BunContext.Layer;",
			"type T = typeof BunContext;",
			"type T = typeof BunContext.layer;",
			"const value = { BunContext };",
			"const value = { BunContext: 1 };",
			'const value = BunContext["layer"];',
			"const value = BunContext?.layer;",
			"const value = BunContext();",
			"const value = BunContext;",
			"const value = <BunContext />;",
			"export { BunContext };",
		]) {
			const input = `import { BunContext } from "@effect/platform-bun";\nBunContext.layer;\n${reference}\n`;
			const result = runTransform(input);

			expect(result.output).toBe(input);
			expect(result.reports).toHaveLength(1);
		}
	});

	test("rejects each unsupported aliased-binding context independently", () => {
		for (const reference of [
			"type T = Legacy;",
			"type T = Legacy.Layer;",
			"type T = typeof Legacy;",
			"type T = typeof Legacy.layer;",
			"const value = { Legacy };",
			"const value = { Legacy: 1 };",
			'const value = Legacy["layer"];',
			"const value = Legacy?.layer;",
			"const value = Legacy();",
			"const value = Legacy;",
			"const value = <Legacy />;",
			"export { Legacy };",
		]) {
			const input = `import { BunContext as Legacy } from "@effect/platform-bun";\nLegacy.layer;\n${reference}\n`;
			const result = runTransform(input);

			expect(result.output).toBe(input);
			expect(result.reports).toEqual([
				"[bun-services] warning: skipped apps/app-backend/src/fixture.ts: unsupported BunContext reference",
			]);
		}
	});

	test("rejects aliased type imports and all import rewrites transactionally", () => {
		for (const input of [
			'import type { BunContext as Legacy } from "@effect/platform-bun";\ntype T = Legacy;\n',
			'import { type BunContext as Legacy } from "@effect/platform-bun";\ntype T = Legacy;\n',
			'import { BunContext, BunContext as Legacy } from "@effect/platform-bun";\nBunContext.layer;\nexport { Legacy };\n',
		]) {
			expect(runTransform(input)).toEqual({
				output: input,
				reports: [
					"[bun-services] warning: skipped apps/app-backend/src/fixture.ts: unsupported BunContext reference",
				],
			});
		}
	});

	test("rejects namespace access transactionally", async () => {
		const input = await readFixture("unsupported-namespace.input.ts");
		expect(runTransform(input)).toEqual({
			output: await readFixture("unsupported-namespace.output.ts"),
			reports: [
				"[bun-services] warning: skipped apps/app-backend/src/fixture.ts: unsupported BunContext reference",
			],
		});
	});

	test("rejects each namespace access form independently", () => {
		for (const reference of [
			"Platform.BunContext.layer;",
			'Platform["BunContext"].layer;',
			"Platform?.BunContext.layer;",
			'Platform?.["BunContext"].layer;',
			"type T = Platform.BunContext;",
		]) {
			const input = `import * as Platform from "@effect/platform-bun";\n${reference}\n`;
			const result = runTransform(input);

			expect(result.output).toBe(input);
			expect(result.reports).toHaveLength(1);
		}
	});

	test("preserves direct local for top-level value and type collisions", () => {
		for (const declaration of [
			'import type { BunServices } from "other-package";',
			'import { BunServices } from "other-package";',
			"interface BunServices {}",
			"type BunServices = {};",
			"enum BunServices { Layer }",
			"class BunServices {}",
		]) {
			const input = `${declaration}\nimport { BunContext } from "@effect/platform-bun";\nBunContext.layer;\n`;
			const result = runTransform(input);

			expect(result.output).toContain(
				'import { BunServices as BunContext } from "@effect/platform-bun";',
			);
			expect(result.output).toContain("BunContext.layer;");
		}
	});

	test("preserves direct local when a nested value would capture a reference", () => {
		const input = [
			'import { BunContext } from "@effect/platform-bun";',
			"function layer() {",
			"\tconst BunServices = { layer: 1 };",
			"\treturn [BunContext.layer, BunServices.layer];",
			"}",
			"",
		].join("\n");
		const result = runTransform(input);

		expect(result.output).toContain(
			'import { BunServices as BunContext } from "@effect/platform-bun";',
		);
		expect(result.output).toContain("return [BunContext.layer, BunServices.layer];");
	});

	test("ignores shadowed references but rejects type-space ambiguity", () => {
		const shadowed = [
			'import { BunContext } from "@effect/platform-bun";',
			"function nested(BunContext: { layer: unknown }) {",
			"\treturn BunContext.layer;",
			"}",
			"BunContext.layer;",
			"",
		].join("\n");
		expect(runTransform(shadowed).output).toBe(
			shadowed
				.replace("{ BunContext }", "{ BunServices }")
				.replace("\nBunContext.layer;", "\nBunServices.layer;"),
		);

		const ambiguous =
			'import { BunContext } from "@effect/platform-bun";\nfunction nested<BunContext>() { return BunContext.layer; }\nBunContext.layer;\n';
		expect(runTransform(ambiguous).output).toBe(ambiguous);
	});

	test("reports and ignores excluded paths", async () => {
		const input = await readFixture("direct.input.ts");
		for (const path of [
			"scripts/outside.ts",
			"apps/app-backend/dist/fixture.ts",
			"apps/app-backend/src/runner.generated.ts",
		]) {
			expect(runTransform(input, path)).toEqual({
				output: undefined,
				reports: [`[bun-services] warning: skipped ${path}: outside lexical scope`],
			});
		}
	});

	test("guard detects old API names but permits preserved local aliases", async () => {
		const source = [
			'import { BunContext as Legacy } from "@effect/platform-bun";',
			'import { BunServices as BunContext } from "@effect/platform-bun";',
			'import * as Platform from "@effect/platform-bun";',
			"BunContext.layer;",
			"Platform.BunContext.layer;",
			"",
		].join("\n");
		expect((await scanSource("fixture.ts", source)).map(formatViolation)).toEqual([
			"fixture.ts:1: @effect/platform-bun BunContext",
			"fixture.ts:5: @effect/platform-bun BunContext",
		]);
	});

	test("beta.102 exports BunServices.layer with filesystem and path services", async () => {
		const backend = join(import.meta.dir, "../../apps/app-backend");
		const platform = await import(Bun.resolveSync("@effect/platform-bun", backend));
		const Effect = await import(Bun.resolveSync("effect/Effect", backend));
		const FileSystem = await import(Bun.resolveSync("effect/FileSystem", backend));
		const Path = await import(Bun.resolveSync("effect/Path", backend));

		expect(platform.BunContext).toBeUndefined();
		expect(platform.BunServices.layer).toBeDefined();
		await Effect.runPromise(
			Effect.gen(function* () {
				yield* FileSystem.FileSystem;
				yield* Path.Path;
			}).pipe(Effect.provide(platform.BunServices.layer)),
		);
	});
});
