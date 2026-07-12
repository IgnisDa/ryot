import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import jscodeshift from "jscodeshift";

import transform from "./transforms/runtime-context";

const fixtures = join(import.meta.dir, "fixtures/runtime-context");
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

describe("runtime context", () => {
	for (const name of ["direct", "aliases", "collision", "comments"]) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input);

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual([
				"[runtime-context] transformed apps/app-backend/src/fixture.ts",
			]);

			const second = runTransform(first.output ?? input);
			expect(second.output).toBeUndefined();
			expect(second.reports).toEqual([]);
		});
	}

	test("ignores lexical shadows, unrelated names, retained APIs, and raw templates", async () => {
		const input = await readFixture("negative.input.ts");
		const expected = await readFixture("negative.output.ts");
		const result = runTransform(input);

		expect(input).toBe(expected);
		expect(result.output).toBeUndefined();
		expect(result.reports).toEqual([]);
	});

	test("warns atomically for an unsupported computed member", async () => {
		const input = await readFixture("unsupported.input.ts");
		const expected = await readFixture("unsupported.output.ts");

		for (let attempt = 0; attempt < 2; attempt += 1) {
			const result = runTransform(input);
			expect(result.output).toBe(expected);
			expect(result.reports).toEqual([
				"[runtime-context] warning: skipped apps/app-backend/src/fixture.ts: unsupported Runtime.runPromise usage",
			]);
		}
	});

	for (const [name, source, reason] of [
		[
			"optional member",
			'import { Runtime } from "effect";\ndeclare const runtime: unknown;\nRuntime?.runFork(runtime);\n',
			"unsupported Runtime.runFork usage",
		],
		[
			"owned member reference",
			'import { Effect } from "effect";\nconst capture = Effect.runtime;\n',
			"unsupported Effect.runtime usage",
		],
		[
			"direct function import",
			'import { runtime } from "effect/Effect";\nconst capture = runtime();\n',
			"unsupported direct import effect/Effect.runtime",
		],
		[
			"direct namespace import",
			'import * as Runtime from "effect/Runtime";\ndeclare const context: unknown;\nRuntime.runPromise(context);\n',
			"unsupported direct import effect/Runtime.runPromise",
		],
	] as const) {
		test(`warns atomically for ${name}`, () => {
			const result = runTransform(source);

			expect(result.output).toBe(source);
			expect(result.reports).toEqual([
				`[runtime-context] warning: skipped apps/app-backend/src/fixture.ts: ${reason}`,
			]);
		});
	}

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
				`[runtime-context] warning: skipped ${path}: outside lexical scope`,
			]);
		}
	});
});
