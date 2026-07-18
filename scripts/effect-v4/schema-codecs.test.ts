import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import jscodeshift from "jscodeshift";
import { Result, Schema } from "effect";

import { formatViolation, scanSource } from "./guard";
import transform from "./transforms/schema-codecs";

const fixtures = join(import.meta.dir, "fixtures/schema-codecs");
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

describe("schema codecs", () => {
	for (const [name, path, occurrences] of [
		[
			"direct",
			"apps/app-backend/src/fixture.ts",
			"16 occurrences: decodeUnknown 7, decodeUnknownEither 6, parseJson 3",
		],
		[
			"local",
			"libs/sandbox-sdk/src/fixture.ts",
			"3 occurrences: decodeUnknown 1, decodeUnknownEither 1, parseJson 1",
		],
	] as const) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input, path);

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual([
				`[schema-codecs] transformed ${path} (${occurrences})`,
			]);

			const second = runTransform(first.output ?? input, path);
			expect(second.output).toBeUndefined();
			expect(second.reports).toEqual([]);
		});
	}

	test("leaves v4, other codecs, unrelated imports, shadows, loops, and raw text unchanged", async () => {
		const input = await readFixture("negative.input.ts");
		expect(runTransform(input)).toEqual({ output: undefined, reports: [] });
	});

	test("warns once and leaves entire file unchanged for unsupported parseJson forms", async () => {
		const input = await readFixture("unsupported.input.ts");
		const expected = await readFixture("unsupported.output.ts");
		expect(runTransform(input)).toEqual({
			output: expected,
			reports: [
				"[schema-codecs] warning: skipped apps/app-backend/src/fixture.ts: unsupported Schema.parseJson arity",
			],
		});
	});

	test("atomically rejects each unsupported parseJson shape", () => {
		for (const [expression, reason] of [
			["Schema.parseJson()", "unsupported Schema.parseJson arity"],
			["Schema.parseJson(Schema.String, options)", "unsupported Schema.parseJson arity"],
			["Schema.parseJson(...schemas)", "unsupported Schema.parseJson arity"],
			['Schema["parseJson"](Schema.String)', "unsupported computed Schema.parseJson"],
			["Schema?.parseJson(Schema.String)", "unsupported optional Schema.parseJson"],
			["Schema.parseJson?.(Schema.String)", "unsupported optional Schema.parseJson"],
			["Schema.parseJson", "unsupported Schema.parseJson arity"],
		] as const) {
			const input = `import { Schema } from "effect";\nconst decode = Schema.decodeUnknown(Schema.String);\nconst value = ${expression};\n`;
			expect(runTransform(input)).toEqual({
				output: input,
				reports: [`[schema-codecs] warning: skipped apps/app-backend/src/fixture.ts: ${reason}`],
			});
		}
	});

	test("atomically rejects each unsupported decodeUnknownEither shape", () => {
		for (const [expression, reason] of [
			[
				'Schema["decodeUnknownEither"](Schema.String)',
				"unsupported computed Schema.decodeUnknownEither",
			],
			[
				"Schema?.decodeUnknownEither(Schema.String)",
				"unsupported optional Schema.decodeUnknownEither",
			],
			[
				"Schema.decodeUnknownEither?.(Schema.String)",
				"unsupported optional Schema.decodeUnknownEither",
			],
		] as const) {
			const input = `import { Schema } from "effect";\nconst decode = Schema.decodeUnknown(Schema.String);\nconst value = ${expression};\n`;
			expect(runTransform(input)).toEqual({
				output: input,
				reports: [`[schema-codecs] warning: skipped apps/app-backend/src/fixture.ts: ${reason}`],
			});
		}
	});

	test("decodeUnknownResult returns direct beta.102 Result values and SchemaError failures", () => {
		const decode = Schema.decodeUnknownResult(Schema.Struct({ value: Schema.String }));
		const success = decode({ value: "valid" });
		const failure = decode({ value: 1 });

		expect(Result.isSuccess(success)).toBe(true);
		expect(success).toMatchObject({ _tag: "Success", success: { value: "valid" } });
		expect(Result.isFailure(failure)).toBe(true);
		expect(failure).toMatchObject({ _tag: "Failure", failure: { _tag: "SchemaError" } });
	});

	test("transformed fixtures pass the legacy codec guard", async () => {
		for (const name of ["direct", "local"] as const) {
			const source = await readFixture(`${name}.output.ts`);
			expect(await scanSource(`apps/app-backend/src/${name}.ts`, source)).toEqual([]);
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
				reports: [`[schema-codecs] warning: skipped ${path}: outside lexical scope`],
			});
		}
	});
});

test("guard reports owned legacy codecs without flagging v4, shadows, or raw text", async () => {
	const source = [
		'import { Schema as S } from "effect";',
		'import { Schema as SdkSchema } from "@ryot/sandbox-sdk/effect";',
		'import { Schema as WorkflowSchema } from "@ryot/sandbox-sdk/workflow";',
		"const decode = S.decodeUnknown(S.String);",
		"const result = S.decodeUnknownEither(S.String);",
		"const json = SdkSchema.parseJson(SdkSchema.String);",
		'const computed = WorkflowSchema["parseJson"](WorkflowSchema.String);',
		"const currentDecode = S.decodeUnknownEffect(S.String);",
		"const currentResult = S.decodeUnknownResult(S.String);",
		"const currentJson = S.fromJsonString(S.String);",
		"const sync = S.decodeUnknownSync(S.String);",
		"const shadowed = (S: any) => S.decodeUnknown(S.String);",
		"const shadowedResult = (S: any) => S.decodeUnknownEither(S.String);",
		"for (const S of schemas) S.parseJson(S.String);",
		'const raw = "S.decodeUnknown(S.String); S.decodeUnknownEither(S.String); S.parseJson(S.String);";',
	].join("\n");

	expect((await scanSource("apps/app-backend/src/schema.ts", source)).map(formatViolation)).toEqual([
		"apps/app-backend/src/schema.ts:4: Schema.decodeUnknown",
		"apps/app-backend/src/schema.ts:5: Schema.decodeUnknownEither",
		"apps/app-backend/src/schema.ts:6: Schema.parseJson",
		"apps/app-backend/src/schema.ts:7: Schema.parseJson",
	]);
});

test("guard permits local Schema source only inside sandbox-sdk src", async () => {
	const source = [
		'import { Schema as S } from "./effect";',
		"const decode = S.decodeUnknown(S.String);",
		"const result = S.decodeUnknownEither(S.String);",
		"const json = S.parseJson(S.String);",
	].join("\n");

	expect(
		(await scanSource("libs/sandbox-sdk/src/schema.ts", source)).map(formatViolation),
	).toEqual([
		"libs/sandbox-sdk/src/schema.ts:2: Schema.decodeUnknown",
		"libs/sandbox-sdk/src/schema.ts:3: Schema.decodeUnknownEither",
		"libs/sandbox-sdk/src/schema.ts:4: Schema.parseJson",
	]);
	expect(await scanSource("apps/app-backend/src/schema.ts", source)).toEqual([]);
});
