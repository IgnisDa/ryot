import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Effect, Schema, SchemaGetter } from "effect";
import jscodeshift from "jscodeshift";

import { formatViolation, scanSource } from "./guard";
import transform from "./transforms/schema-optionals";

const fixtures = join(import.meta.dir, "fixtures/schema-optionals");
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

describe("schema optionals", () => {
	for (const [name, path, occurrences] of [
		["direct", "apps/app-backend/src/fixture.ts", 3],
		["aliases", "plugins/media/src/fixture.ts", 2],
		["comments", "libs/sandbox-sdk/src/fixture.ts", 1],
		["collision", "apps/app-backend/src/fixture.ts", 1],
		["namespace", "apps/app-backend/src/fixture.ts", 1],
		["create-import", "plugins/media/src/fixture.ts", 1],
		["tuple", "apps/app-backend/src/fixture.ts", 2],
		["tuple-local", "libs/sandbox-sdk/src/fixture.ts", 1],
	] as const) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input, path);

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual([
				`[schema-optionals] transformed ${path} (${occurrences} occurrence${occurrences === 1 ? "" : "s"})`,
			]);

			const second = runTransform(first.output ?? input, path);
			expect(second.output).toBeUndefined();
			expect(second.reports).toEqual([]);
		});
	}

	test("leaves current, unrelated, shadowed, and raw forms unchanged", async () => {
		const input = await readFixture("negative.input.ts");
		expect(runTransform(input)).toEqual({ output: undefined, reports: [] });
	});

	test("warns once and leaves whole file unchanged for unsupported owned forms", async () => {
		const input = await readFixture("unsupported.input.ts");
		const expected = await readFixture("unsupported.output.ts");
		expect(runTransform(input)).toEqual({
			output: expected,
			reports: [
				"[schema-optionals] warning: skipped apps/app-backend/src/fixture.ts: unsupported Schema.optionalWith options",
			],
		});
	});

	test("adds a collision-safe alias when imported Effect is shadowed at the rewrite", () => {
		const input = [
			'import { Effect, Schema } from "effect";',
			"const make = (Effect: unknown) =>",
			"\tSchema.optionalWith(Schema.String, { default: () => currentValue() });",
		].join("\n");
		const result = runTransform(input);

		expect(result.output).toContain(
			'import { Effect, Schema, Effect as EffectRuntime, SchemaGetter } from "effect";',
		);
		expect(result.output).toContain(
			"Schema.withConstructorDefault(EffectRuntime.sync(() => currentValue()))",
		);
	});

	test("adds a collision-safe alias when imported SchemaGetter is shadowed", () => {
		const input = [
			'import { Schema, SchemaGetter } from "effect";',
			"const make = (SchemaGetter: unknown) =>",
			"\tSchema.optionalWith(Schema.String, { default: () => currentValue() });",
		].join("\n");
		const result = runTransform(input);

		expect(result.output).toContain("SchemaGetter as SchemaGetterRuntime");
		expect(result.output).toContain("SchemaGetterRuntime.withDefault");
	});

	test("preserves v3 default decode, encode, make, and laziness semantics on beta.102", () => {
		let schemaCalls = 0;
		let thunkCalls = 0;
		const makeSchema = () => {
			schemaCalls += 1;
			return Schema.Array(Schema.String);
		};
		const thunk = () => {
			thunkCalls += 1;
			return [] as string[];
		};
		const field = makeSchema().pipe(
			(schema) =>
				Schema.optional(schema).pipe(
					Schema.decodeTo(Schema.toType(schema), {
						decode: SchemaGetter.withDefault(Effect.sync(thunk)),
						encode: SchemaGetter.required(),
					}),
				),
			Schema.withConstructorDefault(Effect.sync(thunk)),
		);
		const schema = Schema.Struct({ values: field });

		expect(schemaCalls).toBe(1);
		expect(thunkCalls).toBe(0);
		const decodedMissing = Schema.decodeUnknownSync(schema)({});
		const decodedUndefined = Schema.decodeUnknownSync(schema)({ values: undefined });
		expect(thunkCalls).toBe(2);
		expect(decodedMissing.values).toEqual([]);
		expect(decodedUndefined.values).toEqual([]);
		expect(decodedMissing.values).not.toBe(decodedUndefined.values);
		expect(Schema.decodeUnknownSync(schema)({ values: ["present"] })).toEqual({
			values: ["present"],
		});
		expect(() => Schema.encodeUnknownSync(schema)({})).toThrow("Missing key");
		expect(() => Schema.encodeUnknownSync(schema)({ values: undefined })).toThrow(
			"Expected array, got undefined",
		);
		expect(Schema.encodeUnknownSync(schema)({ values: ["present"] })).toEqual({
			values: ["present"],
		});
		expect(thunkCalls).toBe(2);
		const madeFirst = schema.make({});
		const madeSecond = schema.make({});
		expect(thunkCalls).toBe(4);
		expect(madeFirst.values).toEqual([]);
		expect(madeSecond.values).toEqual([]);
		expect(madeFirst.values).not.toBe(madeSecond.values);
	});

	test("preserves v3 optional tuple decode, encode, and constructor semantics on beta.102", () => {
		const schema = Schema.Tuple([Schema.optionalKey(Schema.NumberFromString)]);

		expect(Schema.decodeUnknownSync(schema)([])).toEqual([]);
		expect(Schema.decodeUnknownSync(schema)(["1"])).toEqual([1]);
		expect(() => Schema.decodeUnknownSync(schema)([undefined])).toThrow();
		expect(() => Schema.decodeUnknownSync(schema)(["1", "2"])).toThrow();
		expect(Schema.encodeUnknownSync(schema)([])).toEqual([]);
		expect(Schema.encodeUnknownSync(schema)([1])).toEqual(["1"]);
		expect(() => Schema.encodeUnknownSync(schema)([undefined])).toThrow();
		expect(() => Schema.encodeUnknownSync(schema)([1, 2])).toThrow();
		expect(schema.make([])).toEqual([]);
		expect(schema.make([1])).toEqual([1]);
		expect(() => schema.make([undefined])).toThrow();
		expect(() => schema.make([1, 2])).toThrow();
	});

	test("atomically rejects each unsupported shape", () => {
		for (const [expression, reason] of [
			["Schema.optionalWith(Schema.String, { exact: true })", "options"],
			["Schema.optionalWith(Schema.String, { nullable: true, default: () => '' })", "options"],
			["Schema.optionalWith(Schema.String, { default: () => '', ...options })", "options"],
			["Schema.optionalWith(Schema.String, { ['default']: () => '' })", "options"],
			["Schema.optionalWith(Schema.String, { default() { return ''; } })", "options"],
			["Schema.optionalWith(Schema.String, { default: value })", "default"],
			["Schema.optionalWith(Schema.String, { default: async () => '' })", "default"],
			["Schema.optionalWith<string>(Schema.String, { default: () => '' })", "type arguments"],
			[
				"Schema.optionalWith?.(Schema.String, { default: () => '' })",
				"optional Schema.optionalWith",
			],
			[
				"Schema?.optionalWith(Schema.String, { default: () => '' })",
				"optional Schema.optionalWith",
			],
			[
				'Schema["optionalWith"](Schema.String, { default: () => "" })',
				"computed Schema.optionalWith",
			],
			["Schema.optionalWith(Schema.String)", "arguments"],
		] as const) {
			const input = `import { Schema } from "effect";\nconst valid = Schema.optionalWith(Schema.Number, { default: () => 0 });\nconst value = ${expression};\n`;
			expect(runTransform(input)).toEqual({
				output: input,
				reports: [
					`[schema-optionals] warning: skipped apps/app-backend/src/fixture.ts: unsupported ${reason.startsWith("optional") || reason.startsWith("computed") ? reason : `Schema.optionalWith ${reason}`}`,
				],
			});
		}
	});

	test("atomically rejects unsupported optionalElement shapes and contexts", () => {
		for (const [expression, reason] of [
			["Schema.optionalElement<string>(Schema.String)", "type arguments"],
			["Schema.optionalElement?.(Schema.String)", "optional Schema.optionalElement"],
			["Schema?.optionalElement(Schema.String)", "optional Schema.optionalElement"],
			['Schema["optionalElement"](Schema.String)', "computed Schema.optionalElement"],
			["Schema.optionalElement(Schema.String, Schema.Number)", "arguments"],
			["Schema.optionalElement(...schemas)", "arguments"],
			["Schema.optionalElement(Schema.String)", "usage"],
			["Schema.optionalElement(Schema.String).annotations({})", "usage"],
			["Schema.optionalElement(Schema.String).pipe(identity)", "usage"],
			["Schema.Tuple(Schema.optionalElement(Schema.String))", "variadic Schema.Tuple parent"],
			["OtherSchema.Tuple(Schema.optionalElement(Schema.String))", "usage"],
		] as const) {
			const input = [
				'import { Schema } from "effect";',
				'import { Schema as OtherSchema } from "schema-library";',
				"const valid = Schema.Tuple([Schema.optionalElement(Schema.Number)]);",
				`const value = ${expression};`,
			].join("\n");
			expect(runTransform(input)).toEqual({
				output: input,
				reports: [
					`[schema-optionals] warning: skipped apps/app-backend/src/fixture.ts: unsupported ${reason.startsWith("optional") || reason.startsWith("computed") ? reason : `Schema.optionalElement ${reason}`}`,
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
				reports: [`[schema-optionals] warning: skipped ${path}: outside lexical scope`],
			});
		}
	});

});

test("guard reports every owned optionalWith form with lexical parity", async () => {
	const source = [
		'import { Schema as S } from "effect";',
		'import { Schema as SdkSchema } from "@ryot/sandbox-sdk/effect";',
		'import { Schema as WorkflowSchema } from "@ryot/sandbox-sdk/workflow";',
		"const direct = S.optionalWith(S.String, { default: () => '' });",
		"const unsupported = SdkSchema.optionalWith(SdkSchema.String, { exact: true });",
		"const computed = WorkflowSchema['optionalWith'](WorkflowSchema.String, options);",
		"const optional = S?.optionalWith(S.String, options);",
		"const tuple = S.Tuple(S.optionalElement(S.String));",
		"const computedElement = S['optionalElement'](S.String);",
		"const shadowed = (S: any) => S.optionalWith(S.String, options);",
		"for (const S of schemas) S.optionalWith(S.String, options);",
		"const generic = <S>() => S.optionalWith(S.String, options);",
		"const raw = 'S.optionalWith(S.String, options)';",
	].join("\n");

	expect((await scanSource("apps/app-backend/src/schema.ts", source)).map(formatViolation)).toEqual(
		[
			"apps/app-backend/src/schema.ts:4: Schema.optionalWith",
			"apps/app-backend/src/schema.ts:5: Schema.optionalWith",
			"apps/app-backend/src/schema.ts:6: Schema.optionalWith",
			"apps/app-backend/src/schema.ts:7: Schema.optionalWith",
			"apps/app-backend/src/schema.ts:8: Schema.optionalElement",
			"apps/app-backend/src/schema.ts:8: Schema.Tuple legacy arguments",
			"apps/app-backend/src/schema.ts:9: Schema.optionalElement",
		],
	);
});

test("guard permits local Schema source only inside sandbox-sdk src", async () => {
	const source = [
		'import { Schema as S } from "./effect";',
		"const value = S.optionalWith(S.String, { default: () => '' });",
		"const tuple = S.Tuple(S.optionalElement(S.String));",
	].join("\n");

	expect((await scanSource("libs/sandbox-sdk/src/schema.ts", source)).map(formatViolation)).toEqual(
		[
			"libs/sandbox-sdk/src/schema.ts:2: Schema.optionalWith",
			"libs/sandbox-sdk/src/schema.ts:3: Schema.optionalElement",
			"libs/sandbox-sdk/src/schema.ts:3: Schema.Tuple legacy arguments",
		],
	);
	expect(await scanSource("apps/app-backend/src/schema.ts", source)).toEqual([]);
});
