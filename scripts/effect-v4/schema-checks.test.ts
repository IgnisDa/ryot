import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Schema } from "effect";
import jscodeshift from "jscodeshift";

import { Schema as SchemaV3 } from "../../apps/app-client-backup/node_modules/effect";
import { formatViolation, scanSource } from "./guard";
import transform from "./transforms/schema-checks";

const fixtures = join(import.meta.dir, "fixtures/schema-checks");
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

describe("schema checks", () => {
	for (const [name, path, occurrences] of [
		[
			"direct",
			"apps/app-backend/src/fixture.ts",
			"20 occurrences: supported signs positive 1, nonNegative 1; checks greaterThan 1, greaterThanOrEqualTo 1, lessThan 1, lessThanOrEqualTo 1, between 1, int 1, multipleOf 1, finite 1, minItems 1, maxItems 1, minLength 2, maxLength 2, length 2, pattern 1, nonEmptyString 1",
		],
		[
			"aliases",
			"apps/app-backend/src/fixture.ts",
			"3 occurrences: checks int 1, minLength 1, nonEmptyString 1",
		],
		["local", "libs/sandbox-sdk/src/fixture.ts", "1 occurrences: checks pattern 1"],
	] as const) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input, path);

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual([`[schema-checks] transformed ${path} (${occurrences})`]);
			expect(runTransform(first.output ?? input, path)).toEqual({ output: undefined, reports: [] });
		});
	}

	test("leaves current checks, unrelated namespaces, shadows, loops, and raw text unchanged", async () => {
		const input = await readFixture("negative.input.ts");
		expect(runTransform(input)).toEqual({ output: undefined, reports: [] });
	});

	test("atomically rejects unsupported owned calls", async () => {
		const input = await readFixture("unsupported.input.ts");
		const expected = await readFixture("unsupported.output.ts");
		expect(runTransform(input)).toEqual({
			output: expected,
			reports: [
				"[schema-checks] warning: skipped apps/app-backend/src/fixture.ts: unsupported Schema.int type arguments",
			],
		});

		for (const [expression, reason] of [
			['Schema["int"]()', "unsupported computed Schema.int"],
			["Schema?.int()", "unsupported optional Schema.int"],
			["Schema.int?.()", "unsupported optional Schema.int"],
			["Schema.int", "unsupported Schema.int usage"],
			["Schema.minLength(...values)", "unsupported Schema.minLength spread arguments"],
			["Schema.pattern<string>(/fixture/)", "unsupported Schema.pattern type arguments"],
			["Schema.between(1)", "unsupported Schema.between argument count"],
			["Schema.length(getLength())", "unsupported Schema.length value"],
			["Schema.minLength(1, options)", "unsupported Schema.minLength dynamic annotations"],
			[
				'Schema.minLength(1, { message: () => { return "required"; } })',
				"unsupported Schema.minLength unsupported message callback",
			],
			[
				'Schema.minLength(1, { message: (value) => "required" })',
				"unsupported Schema.minLength unsupported message callback",
			],
			[
				'Schema.minLength(1, { message() { return "required"; } })',
				"unsupported Schema.minLength unsupported annotation property",
			],
			[
				"Schema.minLength(1, { ...annotations })",
				"unsupported Schema.minLength unsupported annotation property",
			],
			[
				'Schema.minLength(1, { ["message"]: () => "required" })',
				"unsupported Schema.minLength unsupported annotation property",
			],
			[
				"Schema.minLength(1, { message })",
				"unsupported Schema.minLength unsupported annotation property",
			],
		] as const) {
			const source = `import { Schema } from "effect";\nconst valid = Schema.int();\nconst value = ${expression};\n`;
			expect(runTransform(source)).toEqual({
				output: source,
				reports: [`[schema-checks] warning: skipped apps/app-backend/src/fixture.ts: ${reason}`],
			});
			expect((await scanSource("apps/app-backend/src/fixture.ts", source)).length).toBe(2);
		}
	});

	test("atomically rejects unsupported negative signs and retains guard violations", async () => {
		const input = await readFixture("unsupported-sign.input.ts");
		const expected = await readFixture("unsupported-sign.output.ts");
		const path = "apps/app-backend/src/fixture.ts";

		expect(runTransform(input, path)).toEqual({
			output: expected,
			reports: [
				"[schema-checks] warning: skipped apps/app-backend/src/fixture.ts: unsupported sign Schema.negative; guard violation retained",
			],
		});
		expect((await scanSource(path, expected)).map(formatViolation)).toEqual([
			`${path}:3: Schema.positive`,
			`${path}:4: Schema.negative`,
			`${path}:5: Schema.nonPositive`,
		]);
	});

	test("atomically rejects missing arguments before mapping helpers", () => {
		for (const name of [
			"greaterThan",
			"greaterThanOrEqualTo",
			"lessThan",
			"lessThanOrEqualTo",
			"between",
			"multipleOf",
			"minItems",
			"maxItems",
			"minLength",
			"maxLength",
			"length",
			"pattern",
		] as const) {
			const source = `import { Schema } from "effect";\nconst valid = Schema.int();\nconst value = Schema.${name}();\n`;
			expect(runTransform(source)).toEqual({
				output: source,
				reports: [
					`[schema-checks] warning: skipped apps/app-backend/src/fixture.ts: unsupported Schema.${name} argument count`,
				],
			});
		}
	});

	test("atomically rejects unsupported sign calls", () => {
		for (const [expression, reason] of [
			["Schema.positive({}, {})", "unsupported Schema.positive argument count"],
			["Schema.nonNegative(...values)", "unsupported Schema.nonNegative spread arguments"],
			["Schema.negative<number>()", "unsupported sign Schema.negative; guard violation retained"],
			[
				'Schema.nonPositive({ message: (value) => "non-positive" })',
				"unsupported sign Schema.nonPositive; guard violation retained",
			],
		] as const) {
			const source = `import { Schema } from "effect";\nconst valid = Schema.positive();\nconst value = ${expression};\n`;
			expect(runTransform(source)).toEqual({
				output: source,
				reports: [`[schema-checks] warning: skipped apps/app-backend/src/fixture.ts: ${reason}`],
			});
		}
	});

	test("beta checks preserve boundaries and custom messages", () => {
		for (const [schema, accepted, rejected] of [
			[Schema.Number.check(Schema.isGreaterThan(1)), [2], [1]],
			[Schema.Number.check(Schema.isGreaterThanOrEqualTo(1)), [1], [0]],
			[Schema.Number.check(Schema.isLessThan(1)), [0], [1]],
			[Schema.Number.check(Schema.isLessThanOrEqualTo(1)), [1], [2]],
			[Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 2 })), [1, 2], [0, 3]],
			[Schema.Number.check(Schema.isInt()), [1], [1.5]],
			[Schema.Number.check(Schema.isMultipleOf(2)), [4], [3]],
			[Schema.Number.check(Schema.isFinite()), [1], [Number.POSITIVE_INFINITY]],
			[Schema.String.check(Schema.isMinLength(2)), ["ab"], ["a"]],
			[Schema.String.check(Schema.isMaxLength(2)), ["ab"], ["abc"]],
			[Schema.String.check(Schema.isLengthBetween(1, 2)), ["a", "ab"], ["", "abc"]],
			[Schema.String.check(Schema.isPattern(/^a+$/)), ["aa"], ["ab"]],
			[Schema.String.check(Schema.isNonEmpty()), ["a"], [""]],
		] as const) {
			for (const value of accepted) expect(Schema.is(schema)(value)).toBe(true);
			for (const value of rejected) expect(Schema.is(schema)(value)).toBe(false);
		}

		const schema = Schema.Number.check(
			Schema.isBetween({ minimum: 1, maximum: 2 }, { message: "custom range" }),
		);
		expect(() => Schema.decodeUnknownSync(schema)(0)).toThrow("custom range");
	});

	test("array length checks preserve v3 boundaries and custom messages", () => {
		for (const [legacy, beta, accepted, rejected] of [
			[
				SchemaV3.Array(SchemaV3.String).pipe(SchemaV3.minItems(1)),
				Schema.Array(Schema.String).check(Schema.isMinLength(1)),
				[["one"]],
				[[]],
			],
			[
				SchemaV3.Array(SchemaV3.String).pipe(SchemaV3.maxItems(2)),
				Schema.Array(Schema.String).check(Schema.isMaxLength(2)),
				[[], ["one", "two"]],
				[["one", "two", "three"]],
			],
		] as const) {
			for (const value of accepted) {
				expect(SchemaV3.is(legacy)(value)).toBe(true);
				expect(Schema.is(beta)(value)).toBe(true);
			}
			for (const value of rejected) {
				expect(SchemaV3.is(legacy)(value)).toBe(false);
				expect(Schema.is(beta)(value)).toBe(false);
			}
		}

		const message = "at least one";
		const legacy = SchemaV3.Array(SchemaV3.String).pipe(
			SchemaV3.minItems(1, { message: () => message }),
		);
		const beta = Schema.Array(Schema.String).check(Schema.isMinLength(1, { message }));
		expect(() => SchemaV3.decodeUnknownSync(legacy)([])).toThrow(message);
		expect(() => Schema.decodeUnknownSync(beta)([])).toThrow(message);
	});

	test("supported signs preserve v3 runtime behavior and custom messages", () => {
		const values = [-Infinity, -1, -0, 0, 1, Infinity, NaN];
		for (const [legacy, beta, expected, rejected, message] of [
			[
				SchemaV3.Number.pipe(SchemaV3.positive({ message: () => "custom positive" })),
				Schema.Number.check(Schema.isGreaterThan(0, { message: "custom positive" })),
				[false, false, false, false, true, true, false],
				-1,
				"custom positive",
			],
			[
				SchemaV3.Number.pipe(SchemaV3.nonNegative({ message: () => "custom non-negative" })),
				Schema.Number.check(Schema.isGreaterThanOrEqualTo(0, { message: "custom non-negative" })),
				[false, false, true, true, true, true, false],
				-1,
				"custom non-negative",
			],
		] as const) {
			const legacyResults = values.map((value) => SchemaV3.is(legacy)(value));
			const betaResults = values.map((value) => Schema.is(beta)(value));
			expect(legacyResults).toEqual(expected);
			expect(betaResults).toEqual(expected);
			expect(betaResults).toEqual(legacyResults);
			expect(() => SchemaV3.decodeUnknownSync(legacy)(rejected)).toThrow(message);
			expect(() => Schema.decodeUnknownSync(beta)(rejected)).toThrow(message);
		}
	});

	test("unsupported negative signs differ from beta predicates for NaN", () => {
		expect(SchemaV3.is(SchemaV3.Number.pipe(SchemaV3.negative()))(NaN)).toBe(false);
		expect(Schema.is(Schema.Number.check(Schema.isLessThan(0)))(NaN)).toBe(true);
		expect(SchemaV3.is(SchemaV3.Number.pipe(SchemaV3.nonPositive()))(NaN)).toBe(false);
		expect(Schema.is(Schema.Number.check(Schema.isLessThanOrEqualTo(0)))(NaN)).toBe(true);
	});

	test("reports and ignores paths outside lexical scope", async () => {
		const input = await readFixture("direct.input.ts");
		for (const path of [
			"scripts/outside.ts",
			"apps/app-client-backup/src/fixture.ts",
			"apps/app-backend/dist/fixture.ts",
			"apps/app-backend/src/runner.generated.ts",
		]) {
			expect(runTransform(input, path)).toEqual({
				output: undefined,
				reports: [`[schema-checks] warning: skipped ${path}: outside lexical scope`],
			});
		}
	});
});

test("guard reports every owned legacy check with lexical parity", async () => {
	const names = [
		"positive",
		"nonNegative",
		"negative",
		"nonPositive",
		"greaterThan",
		"greaterThanOrEqualTo",
		"lessThan",
		"lessThanOrEqualTo",
		"between",
		"int",
		"multipleOf",
		"finite",
		"minItems",
		"maxItems",
		"minLength",
		"maxLength",
		"length",
		"pattern",
		"nonEmptyString",
	] as const;
	const source = [
		'import { Schema as S } from "effect";',
		...names.map((name) => `const ${name} = S.${name};`),
		"const current = S.check(S.isInt());",
		"const shadowed = (S: any) => S.int();",
		"for (const S of schemas) S.minLength(1);",
		'const raw = "S.int(); S.pattern(/fixture/);";',
	].join("\n");
	const path = "apps/app-backend/src/fixture.ts";

	expect((await scanSource(path, source)).map(formatViolation)).toEqual(
		names.map((name, index) => `${path}:${index + 2}: Schema.${name}`),
	);

	const transformed = runTransform(
		'import { Schema as S } from "effect";\nconst value = S.Number.pipe(S.int());\n',
		path,
	);
	expect((await scanSource(path, transformed.output ?? "")).map(formatViolation)).toEqual([]);
});
