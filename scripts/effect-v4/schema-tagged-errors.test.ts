import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import jscodeshift from "jscodeshift";

import { formatViolation, scanSource } from "./guard";
import transform from "./transforms/schema-tagged-errors";

const fixtures = join(import.meta.dir, "fixtures/schema-tagged-errors");
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

describe("schema tagged errors", () => {
	for (const [name, path, occurrences] of [
		["direct", "apps/app-backend/src/fixture.ts", 3],
		["aliases-shadows", "apps/app-backend/src/fixture.ts", 2],
		["local", "libs/sandbox-sdk/src/fixture.ts", 1],
	] as const) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input, path);

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual([
				`[schema-tagged-errors] transformed ${path} (${occurrences} occurrence${occurrences === 1 ? "" : "s"})`,
			]);

			const second = runTransform(first.output ?? input, path);
			expect(second.output).toBeUndefined();
			expect(second.reports).toEqual([]);
		});
	}

	test("leaves current, arbitrary, unrelated, named import, shadows, and raw text unchanged", async () => {
		const input = await readFixture("negative.input.ts");
		expect(runTransform(input)).toEqual({ output: undefined, reports: [] });
	});

	test("atomically rejects unsupported owned class heritage", () => {
		for (const heritage of [
			"Schema.TaggedError",
			'Schema["TaggedError"]<Failure>()("Failure", {})',
			'Schema?.TaggedError<Failure>()("Failure", {})',
			'Schema.TaggedError?.<Failure>()("Failure", {})',
			'Schema.TaggedError<Failure>("Failure", {})',
		]) {
			const input = `import { Schema } from "effect";\nclass Valid extends Schema.TaggedError<Valid>()("Valid", {}) {}\nclass Failure extends ${heritage} {}\n`;
			expect(runTransform(input)).toEqual({
				output: input,
				reports: [
					"[schema-tagged-errors] warning: skipped apps/app-backend/src/fixture.ts: unsupported Schema.TaggedError class heritage",
				],
			});
		}
	});

	test("reports and ignores paths outside lexical scope", async () => {
		const input = await readFixture("direct.input.ts");
		for (const path of [
			"scripts/outside.ts",
			"apps/app-backend/dist/fixture.ts",
			"apps/app-backend/src/runner.generated.ts",
		]) {
			expect(runTransform(input, path)).toEqual({
				output: undefined,
				reports: [`[schema-tagged-errors] warning: skipped ${path}: outside lexical scope`],
			});
		}
	});
});

test("guard reports owned legacy tagged errors with lexical parity", async () => {
	const source = [
		'import { Schema as S } from "effect";',
		'import { Schema as SdkSchema } from "@ryot/sandbox-sdk/effect";',
		'class Direct extends S.TaggedError<Direct>()("Direct", {}) {}',
		'const computed = SdkSchema["TaggedError"];',
		"const current = S.TaggedErrorClass;",
		"const shadowed = (S: any) => S.TaggedError;",
		'const raw = "S.TaggedError";',
	].join("\n");

	expect((await scanSource("apps/app-backend/src/schema.ts", source)).map(formatViolation)).toEqual([
		"apps/app-backend/src/schema.ts:3: Schema.TaggedError",
		"apps/app-backend/src/schema.ts:4: Schema.TaggedError",
	]);
});
