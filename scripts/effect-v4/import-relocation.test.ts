import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import jscodeshift from "jscodeshift";

import transform from "./transforms/import-relocation";

const fixtures = join(import.meta.dir, "fixtures/import-relocation");
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

describe("import relocation", () => {
	for (const name of ["platform", "workflow", "workflow-instance-value", "atom", "testing"]) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input);

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual([
				"[import-relocation] transformed apps/app-backend/src/fixture.ts",
			]);

			const second = runTransform(first.output ?? input);
			expect(second.output).toBeUndefined();
			expect(second.reports).toEqual([]);
		});
	}

	test("warns and leaves whole file unchanged for unsupported references", async () => {
		const input = await readFixture("unsupported.input.ts");
		const expected = await readFixture("unsupported.output.ts");
		const result = runTransform(input);

		expect(result.output).toBe(expected);
		expect(result.reports).toHaveLength(1);
		expect(result.reports[0]).toContain("warning: skipped");
		expect(result.reports[0]).toContain("unsupported reference to isPlatformError");
	});

	test("reports and ignores out-of-scope paths", async () => {
		const input = await readFixture("platform.input.ts");
		const result = runTransform(input, "scripts/outside.ts");

		expect(result.output).toBeUndefined();
		expect(result.reports).toEqual([
			"[import-relocation] warning: skipped scripts/outside.ts: outside lexical scope",
		]);
	});
});
