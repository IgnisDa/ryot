import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import jscodeshift from "jscodeshift";

import transform from "./transforms/vitest";

const fixtures = join(import.meta.dir, "fixtures/vitest");
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

describe("vitest", () => {
	for (const [name, path] of [
		["methods", "apps/app-backend/src/fixture.test.ts"],
		["equality-mixed", "apps/app-backend/src/fixture.test.ts"],
		["setup", "apps/app-backend/test-setup.ts"],
		["config-one-line", "apps/app-backend/vitest.config.ts"],
		["config-multiline", "tests/vitest.config.ts"],
		["support", "tests/src/support/effect-test.ts"],
	] as const) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input, path);

			expect(first.output).toBe(expected);
			if (name === "setup") {
				expect(first.output).toBe("\n");
			}
			expect(first.reports).toEqual([`[vitest] transformed ${path}`]);

			const second = runTransform(first.output ?? input, path);
			expect(second.output).toBeUndefined();
			expect(second.reports).toEqual([]);
		});
	}

	test("warns and leaves the whole file unchanged for unsupported equality usage", async () => {
		const input = await readFixture("unsupported-equality.input.ts");
		const expected = await readFixture("unsupported-equality.output.ts");
		const result = runTransform(input);

		expect(result.output).toBe(expected);
		expect(result.reports).toEqual([
			"[vitest] warning: skipped apps/app-backend/src/fixture.ts: unsupported addEqualityTesters usage for addEqualityTesters",
		]);
	});

	test("warns and leaves the whole file unchanged for an unsupported setupFiles shape", async () => {
		const input = await readFixture("unsupported-config.input.ts");
		const expected = await readFixture("unsupported-config.output.ts");
		const result = runTransform(input, "apps/app-backend/vitest.config.ts");

		expect(result.output).toBe(expected);
		expect(result.reports).toEqual([
			"[vitest] warning: skipped apps/app-backend/vitest.config.ts: unsupported setupFiles shape",
		]);
	});

	test("warns and leaves the whole file unchanged for an unsupported test binding", async () => {
		const input = await readFixture("unsupported-binding.input.ts");
		const expected = await readFixture("unsupported-binding.output.ts");
		const result = runTransform(input);

		expect(result.output).toBe(expected);
		expect(result.reports).toEqual([
			"[vitest] warning: skipped apps/app-backend/src/fixture.ts: unsupported test binding for it.scoped",
		]);
	});

	test("reports and ignores paths outside lexical scope", async () => {
		const input = await readFixture("methods.input.ts");

		for (const path of [
			"scripts/outside.ts",
			"apps/app-backend/dist/fixture.ts",
			"apps/app-backend/src/runner.generated.ts",
		]) {
			const result = runTransform(input, path);

			expect(result.output).toBeUndefined();
			expect(result.reports).toEqual([`[vitest] warning: skipped ${path}: outside lexical scope`]);
		}
	});
});
