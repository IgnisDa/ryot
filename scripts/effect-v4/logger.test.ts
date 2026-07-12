import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import jscodeshift from "jscodeshift";

import transform from "./transforms/logger";

const fixtures = join(import.meta.dir, "fixtures/logger");
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

describe("logger", () => {
	for (const [name, count] of [
		["direct", 15],
		["observability", 9],
		["aliases", 5],
		["import-reuse", 2],
		["collisions", 1],
		["comments", 2],
	] as const) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input);

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual([
				`[logger] transformed apps/app-backend/src/fixture.ts (${count} occurrence${count === 1 ? "" : "s"})`,
			]);

			const second = runTransform(first.output ?? input);
			expect(second.output).toBeUndefined();
			expect(second.reports).toEqual([]);
		});
	}

	test("ignores shadows, unrelated names, v4 members, and raw strings and templates", async () => {
		const input = await readFixture("negative.input.ts");
		const expected = await readFixture("negative.output.ts");
		const result = runTransform(input);

		expect(input).toBe(expected);
		expect(result.output).toBeUndefined();
		expect(result.reports).toEqual([]);
	});

	test("warns atomically for an unsupported owned member", async () => {
		const input = await readFixture("unsupported.input.ts");
		const expected = await readFixture("unsupported.output.ts");

		for (let attempt = 0; attempt < 2; attempt += 1) {
			const result = runTransform(input);
			expect(result.output).toBe(expected);
			expect(result.reports).toEqual([
				"[logger] warning: skipped apps/app-backend/src/fixture.ts: unsupported Logger.replace usage",
			]);
		}
	});

	for (const [name, source, reason] of [
		[
			"non-default replacement",
			'import { Logger } from "effect";\ndeclare const logger: Logger.Logger<unknown, void>;\nLogger.replace(logger, logger);\n',
			"unsupported Logger.replace usage",
		],
		[
			"zip expressions",
			'import { Logger } from "effect";\ndeclare const makeLogger: () => Logger.Logger<unknown, void>;\nLogger.zip(makeLogger(), makeLogger());\n',
			"unsupported Logger.zip usage",
		],
		[
			"pretty options",
			'import { Logger } from "effect";\nLogger.prettyLogger({ colors: false });\n',
			"unsupported Logger.prettyLogger usage",
		],
		[
			"computed log level",
			'import { LogLevel } from "effect";\nconst level = LogLevel["Info"];\n',
			"unsupported LogLevel.Info usage",
		],
	] as const) {
		test(`warns atomically for ${name}`, () => {
			const result = runTransform(source);

			expect(result.output).toBe(source);
			expect(result.reports).toEqual([
				`[logger] warning: skipped apps/app-backend/src/fixture.ts: ${reason}`,
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
				`[logger] warning: skipped ${path}: outside lexical scope`,
			]);
		}
	});
});
