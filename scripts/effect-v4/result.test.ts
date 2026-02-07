import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import jscodeshift from "jscodeshift";

import transform from "./transforms/result";

const fixtures = join(import.meta.dir, "fixtures/result");
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

describe("result", () => {
	for (const name of [
		"imports",
		"local-export",
		"type-only",
		"namespace",
		"effect",
		"ownership",
		"snapshots",
		"aliases-negative",
	]) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input);

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual(["[result] transformed apps/app-backend/src/fixture.ts"]);

			const second = runTransform(first.output ?? input);
			expect(second.output).toBeUndefined();
			expect(second.reports).toEqual([]);
		});
	}

	test("leaves a zero-interpolation embedded source template unchanged", async () => {
		const input = await readFixture("embedded.input.ts");
		const expected = await readFixture("embedded.output.ts");
		const result = runTransform(input);

		expect(input).toBe(expected);
		expect(result.output).toBeUndefined();
		expect(result.reports).toEqual([]);
	});

	test("warns and leaves the whole file unchanged for an unsupported Either member", async () => {
		const input = await readFixture("unsupported.input.ts");
		const expected = await readFixture("unsupported.output.ts");
		const result = runTransform(input);

		expect(result.output).toBe(expected);
		expect(result.reports).toEqual([
			"[result] warning: skipped apps/app-backend/src/fixture.ts: unsupported Either member map",
		]);
	});

	for (const [name, reason] of [
		["unsupported-computed", "unsupported Result destructuring property left"],
		["unsupported-cross-export", "cross-declaration Result export collision"],
		["unsupported-member-alias", "unsupported Either member reference left"],
		["unsupported-reverse-export", "cross-declaration Result export collision"],
	] as const) {
		test(`${name} warns atomically and remains idempotent`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);

			for (let attempt = 0; attempt < 2; attempt += 1) {
				const result = runTransform(input);
				expect(result.output).toBe(expected);
				expect(result.reports).toEqual([
					`[result] warning: skipped apps/app-backend/src/fixture.ts: ${reason}`,
				]);
			}
		});
	}

	test("reports and ignores paths outside lexical scope", async () => {
		const input = await readFixture("out-of-scope.input.ts");

		for (const path of [
			"scripts/outside.ts",
			"apps/app-backend/dist/fixture.ts",
			"apps/app-backend/src/runner.generated.ts",
		]) {
			const result = runTransform(input, path);

			expect(result.output).toBeUndefined();
			expect(result.reports).toEqual([`[result] warning: skipped ${path}: outside lexical scope`]);
		}
	});
});
