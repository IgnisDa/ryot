import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import jscodeshift from "jscodeshift";

import { formatViolation, scanSource } from "./guard";
import transform from "./transforms/schema-annotations";

const fixtures = join(import.meta.dir, "fixtures/schema-annotations");
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

describe("schema annotations", () => {
	for (const [name, path, occurrences] of [
		["direct", "apps/app-backend/src/fixture.ts", "10 occurrences: namespace 3, instance 7"],
		[
			"strict-struct",
			"libs/contract/src/modules/query-engine/fixture.ts",
			"1 occurrences: namespace 0, instance 1",
		],
	] as const) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input, path);

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual([
				`[schema-annotations] transformed ${path} (${occurrences})`,
			]);
			expect(runTransform(first.output ?? input, path)).toEqual({ output: undefined, reports: [] });
		});
	}

	test("leaves v4, unrelated, shadowed, computed, optional, and raw forms unchanged", async () => {
		const input = await readFixture("negative.input.ts");
		expect(runTransform(input)).toEqual({ output: undefined, reports: [] });
	});

	test("atomically rejects owned unsupported forms", async () => {
		const input = await readFixture("unsupported.input.ts");
		const expected = await readFixture("unsupported.output.ts");
		expect(runTransform(input)).toEqual({
			output: expected,
			reports: [
				"[schema-annotations] warning: skipped apps/app-backend/src/fixture.ts: unsupported Schema.annotations type arguments",
			],
		});

		for (const [expression, reason] of [
			["Schema.annotations?.({})", "unsupported optional Schema.annotations"],
			["Schema?.annotations({})", "unsupported optional Schema.annotations"],
			['Schema.String["annotations"]({})', "unsupported computed Schema.annotations"],
			["Schema.String.annotations?.({})", "unsupported optional Schema.annotations"],
			["Schema.annotations()", "unsupported Schema.annotations arity"],
			["Schema.annotations({}, {})", "unsupported Schema.annotations arity"],
			["Schema.annotations(...values)", "unsupported Schema.annotations arity"],
			["Schema.annotations", "unsupported Schema.annotations arity"],
			[
				"Schema.Struct({ value: Schema.String }).annotations<{ identifier: string }>({ identifier: 'Typed' })",
				"unsupported Schema.annotations type arguments",
			],
		] as const) {
			const source = `import { Schema } from "effect";\nconst value = ${expression};\n`;
			expect(runTransform(source)).toEqual({
				output: source,
				reports: [`[schema-annotations] warning: skipped apps/app-backend/src/fixture.ts: ${reason}`],
			});
		}
	});

	test("reports and ignores paths outside lexical scope", async () => {
		const input = await readFixture("direct.input.ts");
		for (const path of [
			"scripts/outside.ts",
			"apps/app-client-backup/src/fixture.ts",
			"apps/frontend/src/fixture.ts",
			"libs/graphql/src/fixture.ts",
			"apps/app-backend/dist/fixture.ts",
			"apps/app-backend/src/runner.generated.ts",
		]) {
			expect(runTransform(input, path)).toEqual({
				output: undefined,
				reports: [`[schema-annotations] warning: skipped ${path}: outside lexical scope`],
			});
		}
	});
});

test("guard reports safely owned legacy annotation forms", async () => {
	const source = [
		'import { Schema as S } from "effect";',
		'import { strictStruct as makeStrict } from "../../schema/utils";',
		"const namespace = S.annotations({});",
		"const computed = S['annotations']({});",
		"const staticSchema = S.String.annotations({});",
		"const struct = S.Struct({ value: S.String }).annotations({});",
		"const strict = makeStrict({ value: S.String }).annotations({});",
		"const alias = S.String;",
		"const aliased = alias.annotations({});",
		"let mutableAlias = S.String;",
		"mutableAlias = object;",
		"const mutable = mutableAlias.annotations({});",
		"const current = S.String.annotate({});",
		"const unrelated = object.annotations({});",
		"const shadowed = (S: any) => S.annotations({});",
	].join("\n");

	expect(
		(
			await scanSource("libs/contract/src/modules/query-engine/fixture.ts", source)
		).map(formatViolation),
	).toEqual([
		"libs/contract/src/modules/query-engine/fixture.ts:3: Schema.annotations",
		"libs/contract/src/modules/query-engine/fixture.ts:4: Schema.annotations",
		"libs/contract/src/modules/query-engine/fixture.ts:5: Schema.annotations",
		"libs/contract/src/modules/query-engine/fixture.ts:6: Schema.annotations",
		"libs/contract/src/modules/query-engine/fixture.ts:7: Schema.annotations",
		"libs/contract/src/modules/query-engine/fixture.ts:9: Schema.annotations",
	]);
});

test("guard follows lexical alias bindings", async () => {
	const source = [
		'import { Schema as S } from "effect";',
		"const alias = S.String;",
		"const shadowed = (alias: any) => alias.annotations({});",
		"function first() {",
		"	const schema = S.String;",
		"	return schema.annotations({});",
		"}",
		"function second() {",
		"	const schema = S.Number;",
		"	return schema.annotations({});",
		"}",
	].join("\n");
	const path = "apps/app-backend/src/fixture.ts";

	expect((await scanSource(path, source)).map(formatViolation)).toEqual([
		`${path}:6: Schema.annotations`,
		`${path}:10: Schema.annotations`,
	]);
	const transformed = runTransform(source, path);
	expect(transformed.reports).toEqual([
		`[schema-annotations] transformed ${path} (2 occurrences: namespace 0, instance 2)`,
	]);
	expect((await scanSource(path, transformed.output ?? source)).map(formatViolation)).toEqual([]);
});

test("supports sandbox-sdk local Schema source", async () => {
	const source = [
		'import { Schema } from "./effect";',
		"const value = Schema.String.annotations({});",
	].join("\n");

	expect(runTransform(source, "libs/sandbox-sdk/src/fixture.ts")).toEqual({
		output: source.replace(".annotations", ".annotate"),
		reports: [
			"[schema-annotations] transformed libs/sandbox-sdk/src/fixture.ts (1 occurrences: namespace 0, instance 1)",
		],
	});
});
