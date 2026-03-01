import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import jscodeshift from "jscodeshift";

import transform from "./transforms/services";

const fixtures = join(import.meta.dir, "fixtures/services");
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

describe("services", () => {
	for (const name of ["constructors", "dependencies", "tag", "references"]) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input);

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual(["[services] transformed apps/app-backend/src/fixture.ts"]);

			const second = runTransform(first.output ?? input);
			expect(second.output).toBeUndefined();
			expect(second.reports).toEqual([]);
		});
	}

	test("warns and leaves the whole file unchanged for a static layer collision", async () => {
		const input = await readFixture("unsupported.input.ts");
		const expected = await readFixture("unsupported.output.ts");
		const result = runTransform(input);

		expect(result.output).toBe(expected);
		expect(result.reports).toEqual([
			"[services] warning: skipped apps/app-backend/src/fixture.ts: static layer collision in RedisService",
		]);
	});

	test("warns and leaves the whole file unchanged for unsupported options", () => {
		const source = `import { Effect } from "effect";

export class AppConfig extends Effect.Service<AppConfig>()("AppConfig", {
	effect: Effect.succeed({ name: "app" }),
	accessors: true,
}) {}
`;
		const result = runTransform(source);

		expect(result.output).toBe(source);
		expect(result.reports).toEqual([
			"[services] warning: skipped apps/app-backend/src/fixture.ts: unsupported service option in AppConfig",
		]);
	});

	test("warns and leaves the whole file unchanged for unsupported class members", () => {
		const source = `import { Effect } from "effect";

export class AppConfig extends Effect.Service<AppConfig>()("AppConfig", {
	effect: Effect.succeed({ name: "app" }),
}) {
	static readonly make = Effect.void;
}
`;
		const result = runTransform(source);

		expect(result.output).toBe(source);
		expect(result.reports).toEqual([
			"[services] warning: skipped apps/app-backend/src/fixture.ts: static make collision in AppConfig",
		]);
	});

		test("warns and leaves the whole file unchanged for unsupported tag projections", () => {
			const source = `import { Context } from "effect";

		import { TransactionRunner } from "./db-service";

export class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, { id: string }>() {}
export type TransactionShape = TransactionRunner.Type;
`;
		const result = runTransform(source);

		expect(result.output).toBe(source);
		expect(result.reports).toEqual([
			"[services] warning: skipped apps/app-backend/src/fixture.ts: unsupported migrated tag projection TransactionRunner",
		]);
	});

	test("reports and ignores paths outside lexical scope", async () => {
		const input = await readFixture("constructors.input.ts");

		for (const path of [
			"scripts/outside.ts",
			"apps/app-backend/dist/fixture.ts",
			"apps/app-backend/src/runner.generated.ts",
		]) {
			const result = runTransform(input, path);

			expect(result.output).toBeUndefined();
			expect(result.reports).toEqual([
				`[services] warning: skipped ${path}: outside lexical scope`,
			]);
		}
	});
});
