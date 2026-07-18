import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Schema } from "effect";
import jscodeshift from "jscodeshift";

import transform from "./transforms/schema-constructors";

const fixtures = join(import.meta.dir, "fixtures/schema-constructors");
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

describe("schema constructors", () => {
	for (const [name, occurrences] of [
		["comments", "6 occurrences: Literal 1, Union 1, Record 0, Tuple 4"],
		["constructors", "12 occurrences: Literal 3, Union 6, Record 0, Tuple 3"],
		["imports-shadows", "4 occurrences: Literal 1, Union 1, Record 1, Tuple 1"],
		["record-comments", "3 occurrences: Literal 0, Union 0, Record 3, Tuple 0"],
	] as const) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input);

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual([
				`[schema-constructors] transformed apps/app-backend/src/fixture.ts (${occurrences})`,
			]);

			const second = runTransform(first.output ?? input);
			expect(second.output).toBeUndefined();
			expect(second.reports).toEqual([]);
		});
	}

	test("leaves valid v4, unrelated, shadowed, and raw-template forms unchanged", async () => {
		const input = await readFixture("negative.input.ts");
		expect(runTransform(input)).toEqual({ output: undefined, reports: [] });
	});

	test("preserves beta.102 empty and nonempty Tuple runtime behavior", () => {
		expect(Schema.decodeUnknownSync(Schema.Tuple([]))([])).toEqual([]);
		expect(
			Schema.decodeUnknownSync(Schema.Tuple([Schema.String, Schema.Number]))(["value", 1]),
		).toEqual(["value", 1]);
	});

	test("supports the sandbox-sdk local Schema barrel", () => {
		const input = 'import { Schema as S } from "./effect";\nconst tuple = S.Tuple(S.String);\n';
		expect(runTransform(input, "libs/sandbox-sdk/src/fixture.ts")).toEqual({
			output: 'import { Schema as S } from "./effect";\nconst tuple = S.Tuple([S.String]);\n',
			reports: [
				"[schema-constructors] transformed libs/sandbox-sdk/src/fixture.ts (1 occurrences: Literal 0, Union 0, Record 0, Tuple 1)",
			],
		});
		expect(runTransform(input, "apps/app-backend/src/fixture.ts")).toEqual({
			output: undefined,
			reports: [],
		});
	});

	test("atomically rejects unsupported owned Tuple forms", () => {
		for (const [expression, reason] of [
			["Schema.Tuple(...schemas)", "spread arguments"],
			["Schema.Tuple<string>(Schema.String)", "type arguments"],
			['Schema["Tuple"](Schema.String)', "computed Schema.Tuple"],
			["Schema.Tuple?.(Schema.String)", "optional Schema.Tuple"],
			["Schema?.Tuple(Schema.String)", "optional Schema.Tuple"],
		] as const) {
			const input = [
				'import { Schema } from "effect";',
				"declare const schemas: readonly unknown[];",
				'const literal = Schema.Literal("a", "b");',
				`const tuple = ${expression};`,
			].join("\n");
			expect(runTransform(input)).toEqual({
				output: input,
				reports: [
					`[schema-constructors] warning: skipped apps/app-backend/src/fixture.ts: unsupported ${reason.startsWith("optional") || reason.startsWith("computed") ? reason : `Schema.Tuple ${reason}`}`,
				],
			});
		}
	});

	test("atomically rejects type-parameter-ambiguous Tuple aliases", () => {
		const input = [
			'import { Schema as S } from "effect";',
			'const literal = S.Literal("a", "b");',
			"const ambiguous = <S>() => S.Tuple(S.String);",
		].join("\n");
		expect(runTransform(input)).toEqual({
			output: input,
			reports: [
				"[schema-constructors] warning: skipped apps/app-backend/src/fixture.ts: unsupported ambiguous Schema.Tuple alias",
			],
		});
	});

	test("preserves malformed comment trivia when rejecting unsupported Record objects", async () => {
		const input = await readFixture("unsupported.input.ts");
		const result = runTransform(input);

		expect(result.output).toBe(input);
		expect(result.reports).toEqual([
			"[schema-constructors] warning: skipped apps/app-backend/src/fixture.ts: unsupported Schema.Record object properties",
		]);
	});

	test("rejects every unsupported Record property shape", () => {
		for (const object of [
			"{ key: Schema.String }",
			"{ value: Schema.Number, key: Schema.String }",
			"{ key: Schema.String, key: Schema.Symbol, value: Schema.Number }",
			'{ ["key"]: Schema.String, value: Schema.Number }',
			"{ ...fields, key: Schema.String, value: Schema.Number }",
			"{ key() {}, value: Schema.Number }",
			"{ get key() { return Schema.String; }, value: Schema.Number }",
			"{ key: Schema.String, value: Schema.Number, extra: Schema.Boolean }",
		]) {
			const input = `import { Schema } from "effect";\n\nconst schema = Schema.Record(${object});\n`;
			expect(runTransform(input)).toEqual({
				output: input,
				reports: [
					"[schema-constructors] warning: skipped apps/app-backend/src/fixture.ts: unsupported Schema.Record object properties",
				],
			});
		}
	});

	test("reports and ignores paths outside lexical scope", async () => {
		const input = await readFixture("constructors.input.ts");
		for (const path of [
			"scripts/outside.ts",
			"apps/app-backend/dist/fixture.ts",
			"apps/app-backend/src/runner.generated.ts",
		]) {
			expect(runTransform(input, path)).toEqual({
				output: undefined,
				reports: [`[schema-constructors] warning: skipped ${path}: outside lexical scope`],
			});
		}
	});
});
