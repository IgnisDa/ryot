import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import jscodeshift from "jscodeshift";
import { Schema, SchemaTransformation } from "effect";

import { formatViolation, scanSource } from "./guard";
import transform from "./transforms/schema-transformations";

const fixtures = join(import.meta.dir, "fixtures/schema-transformations");
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

describe("schema transformations", () => {
	for (const [name, path, transformCount, composeCount] of [
		["direct", "apps/app-backend/src/fixture.ts", 1, 2],
		["aliases-shadows", "libs/contract/src/fixture.ts", 1, 1],
		["collision", "apps/app-backend/src/fixture.ts", 1, 0],
		["comments-order", "apps/app-backend/src/fixture.ts", 1, 0],
		["local", "libs/sandbox-sdk/src/fixture.ts", 1, 0],
	] as const) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input, path);
			const occurrences = transformCount + composeCount;

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual([
				`[schema-transformations] transformed ${path} (${occurrences} occurrences: transform ${transformCount}, compose ${composeCount})`,
			]);
			expect(runTransform(first.output ?? input, path)).toEqual({
				output: undefined,
				reports: [],
			});
		});
	}

	test("leaves current, unrelated, shadowed, excluded APIs, and raw forms unchanged", async () => {
		const input = await readFixture("negative.input.ts");
		expect(runTransform(input)).toEqual({ output: undefined, reports: [] });
	});

	test("warns once and leaves whole file unchanged for an unsupported owned form", async () => {
		const input = await readFixture("unsupported.input.ts");
		const expected = await readFixture("unsupported.output.ts");
		expect(runTransform(input)).toEqual({
			output: expected,
			reports: [
				"[schema-transformations] warning: skipped apps/app-backend/src/fixture.ts: unsupported Schema.transform options or callbacks",
			],
		});
	});

	test("atomically rejects unsupported transform shapes and callback signatures", () => {
		for (const expression of [
			"Schema.transform(from, to, { strict: false, decode: (value) => value, encode: (value) => value })",
			"Schema.transform(from, to, { strict: true, decode: (value) => value })",
			"Schema.transform(from, to, { strict: true, decode: (value) => value, encode: (value) => value, extra: true })",
			"Schema.transform(from, to, { strict: true, decode: (value) => value, encode: (value) => value, ...options })",
			"Schema.transform(from, to, { ['strict']: true, decode: (value) => value, encode: (value) => value })",
			"Schema.transform(from, to, { strict: true, decode(value) { return value }, encode: (value) => value })",
			"Schema.transform(from, to, { strict: true, decode, encode })",
			"Schema.transform(from, to, { strict: true, decode: (value, original) => value, encode: (value) => value })",
			"Schema.transform(from, to, { strict: true, decode: (...values) => values[0], encode: (value) => value })",
			"Schema.transform(from, to, { strict: true, decode: <T>(value: T) => value, encode: (value) => value })",
			"Schema.transform<string>(from, to, { strict: true, decode: (value) => value, encode: (value) => value })",
			"Schema.transform?.(from, to, options)",
			"Schema?.transform(from, to, options)",
			"Schema['transform'](from, to, options)",
			"Schema.transform(from, to)",
		] as const) {
			const input = `import { Schema } from "effect";\nconst valid = Schema.compose(from, to);\nconst invalid = ${expression};\n`;
			const result = runTransform(input);
			expect(result.output).toBe(input);
			expect(result.reports).toHaveLength(1);
			expect(result.reports[0]).toContain("[schema-transformations] warning: skipped");
		}
	});

	test("atomically rejects unsupported compose shapes", () => {
		for (const expression of [
			"Schema.compose(from)",
			"Schema.compose(from, to, options)",
			"Schema.compose(...schemas)",
			"Schema.compose<string>(from, to)",
			"Schema.compose?.(from, to)",
			"Schema?.compose(from, to)",
			"Schema['compose'](from, to)",
			"use(Schema.compose(to))",
			"schema.pipe(other, Schema.compose(to))",
		] as const) {
			const input = `import { Schema } from "effect";\nconst valid = Schema.transform(from, to, { strict: true, decode: (value) => value, encode: (value) => value });\nconst invalid = ${expression};\n`;
			const result = runTransform(input);
			expect(result.output).toBe(input);
			expect(result.reports).toHaveLength(1);
			expect(result.reports[0]).toContain("[schema-transformations] warning: skipped");
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
				reports: [`[schema-transformations] warning: skipped ${path}: outside lexical scope`],
			});
		}
	});

	test("preserves beta.102 transform decode and encode behavior", () => {
		const schema = Schema.Literals(["on", "off"]).pipe(
			Schema.decodeTo(
				Schema.Boolean,
				SchemaTransformation.transform({
					decode: (literal) => literal === "on",
					encode: (value) => (value ? "on" : "off"),
				}),
			),
		);

		expect(Schema.decodeUnknownSync(schema)("on")).toBe(true);
		expect(Schema.decodeUnknownSync(schema)("off")).toBe(false);
		expect(Schema.encodeUnknownSync(schema)(true)).toBe("on");
		expect(Schema.encodeUnknownSync(schema)(false)).toBe("off");
	});

	test("preserves beta.102 compose decode and encode behavior", () => {
		const schema = Schema.Trim.pipe(Schema.decodeTo(Schema.String));

		expect(Schema.decodeUnknownSync(schema)("  value  ")).toBe("value");
		expect(Schema.encodeUnknownSync(schema)("value")).toBe("value");
	});
});

test("guard reports only owned legacy transform and compose references", async () => {
	const source = [
		'import { Schema as S } from "effect";',
		'import { Schema as SdkSchema } from "@ryot/sandbox-sdk/effect";',
		'import { Schema as WorkflowSchema } from "@ryot/sandbox-sdk/workflow";',
		"const direct = S.transform(from, to, options);",
		"const compose = SdkSchema.compose(from, to);",
		"const pipeable = schema.pipe(WorkflowSchema.compose(to));",
		"const computed = S['transform'](from, to, options);",
		"const optional = S?.compose(from, to);",
		"const excluded = S.transformOrFail(from, to, options);",
		"const shadowed = (S: any) => S.transform(from, to, options);",
		"const raw = 'S.transform(from, to, options); S.compose(from, to)';",
	].join("\n");

	expect((await scanSource("apps/app-backend/src/schema.ts", source)).map(formatViolation)).toEqual([
		"apps/app-backend/src/schema.ts:4: Schema.transform",
		"apps/app-backend/src/schema.ts:5: Schema.compose",
		"apps/app-backend/src/schema.ts:6: Schema.compose",
		"apps/app-backend/src/schema.ts:7: Schema.transform",
		"apps/app-backend/src/schema.ts:8: Schema.compose",
	]);
});

test("guard permits local Schema source only inside sandbox-sdk src", async () => {
	const source = 'import { Schema as S } from "./effect";\nconst value = S.transform(from, to, options);';
	expect(
		(await scanSource("libs/sandbox-sdk/src/schema.ts", source)).map(formatViolation),
	).toEqual(["libs/sandbox-sdk/src/schema.ts:2: Schema.transform"]);
	expect(await scanSource("apps/app-backend/src/schema.ts", source)).toEqual([]);
});
