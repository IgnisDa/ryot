import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import jscodeshift from "jscodeshift";

import transform from "./transforms/core-renames";

const fixtures = join(import.meta.dir, "fixtures/core-renames");
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

describe("core renames", () => {
	for (const name of ["direct", "aliases", "negative"]) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input);

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual([
				"[core-renames] transformed apps/app-backend/src/fixture.ts",
			]);

			const second = runTransform(first.output ?? input);
			expect(second.output).toBeUndefined();
			expect(second.reports).toEqual([]);
		});
	}

	test("warns atomically for computed target members", () => {
		const input = 'import { Effect } from "effect";\n\nconst legacy = Effect["catchAll"];\n';
		const result = runTransform(input);

		expect(result.output).toBe(input);
		expect(result.reports).toEqual([
			"[core-renames] warning: skipped apps/app-backend/src/fixture.ts: unsupported member syntax Effect.catchAll",
		]);
	});

	test("warns atomically for an unsupported owned extractor shape", () => {
		const input = [
			'import { Effect as Fx } from "effect";',
			"",
			"type Supported = Fx.Effect.Error<string>;",
			"type Unsupported = Fx.Effect[\"Success\"];",
			"",
		].join("\n");
		const result = runTransform(input);

		expect(result.output).toBe(input);
		expect(result.reports).toEqual([
			"[core-renames] warning: skipped apps/app-backend/src/fixture.ts: unsupported Effect.Effect.Success type extractor",
		]);
	});

	test("reports and ignores paths outside lexical scope", async () => {
		const input = await readFixture("direct.input.ts");

		for (const path of [
			"scripts/outside.ts",
			"apps/app-backend/dist/fixture.ts",
			"apps/app-backend/src/runner.generated.ts",
		]) {
			const result = runTransform(input, path);

			expect(result.output).toBeUndefined();
			expect(result.reports).toEqual([
				`[core-renames] warning: skipped ${path}: outside lexical scope`,
			]);
		}
	});
});
