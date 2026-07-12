import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Schema } from "effect";
import jscodeshift from "jscodeshift";

import {
	ParseResult as ParseResultV3,
	Schema as SchemaV3,
} from "../../apps/app-client-backup/node_modules/effect";
import { formatViolation, scanSource } from "./guard";
import transform from "./transforms/schema-filters";

const fixtures = join(import.meta.dir, "fixtures/schema-filters");
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

describe("schema filters", () => {
	for (const [name, occurrences] of [
		["direct", "6 occurrences, 1 messages"],
		["aliases-shadows", "3 occurrences, 0 messages"],
	] as const) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input);

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual([
				`[schema-filters] transformed apps/app-backend/src/fixture.ts (${occurrences})`,
			]);
			expect(runTransform(first.output ?? input)).toEqual({ output: undefined, reports: [] });
		});
	}

	test("supports sandbox local barrel ownership", () => {
		const source =
			'import { Schema as S } from "./effect";\nconst value = S.String.pipe(S.filter((value) => value.length > 0));\n';
		expect(runTransform(source, "libs/sandbox-sdk/src/fixture.ts")).toEqual({
			output:
				'import { Schema as S } from "./effect";\nconst value = S.String.pipe(S.check(S.makeFilter((value) => value.length > 0)));\n',
			reports: [
				"[schema-filters] transformed libs/sandbox-sdk/src/fixture.ts (1 occurrences, 0 messages)",
			],
		});
	});

	test("leaves current filters, filterEffect, strings, and unrelated calls unchanged", async () => {
		expect(runTransform(await readFixture("negative.input.ts"))).toEqual({
			output: undefined,
			reports: [],
		});
	});

	test("supports safe first-parameter shapes and collision-safe lazy wrappers", () => {
		const source = [
			'import { Schema } from "effect";',
			"const schemaFilterInput = 1;",
			"const schemaFilterOutput = 2;",
			"const destructured = Schema.filter(({ length }) => length > 0);",
			'const defaulted = Schema.filter((value = "") => value.length > 0);',
			"const lazy = Schema.filter((value) => value.length > 0, { message: () => message() });",
		].join("\n");
		const result = runTransform(source);

		expect(result.reports).toEqual([
			"[schema-filters] transformed apps/app-backend/src/fixture.ts (3 occurrences, 1 messages)",
		]);
		expect(result.output).toContain("Schema.makeFilter(({ length }) => length > 0)");
		expect(result.output).toContain('Schema.makeFilter((value = "") => value.length > 0)');
		expect(result.output).toContain("Schema.makeFilter(schemaFilterInput2 => {");
		expect(result.output).toContain(
			"const schemaFilterOutput2 = (value => value.length > 0)(schemaFilterInput2);",
		);
		expect(result.output).toContain(": (() => message())()");
		expect(result.output).not.toContain("message:");
	});

	test("supports local callbacks with direct or inferred return types", () => {
		const source = [
			'import { Schema } from "effect";',
			"const inferred = (value: string) => value.length > 0;",
			"const direct = (value: string): boolean => value.length > 0;",
			"function declared(value: string): boolean { return value.length > 0; }",
			"const first = Schema.filter(inferred);",
			"const second = Schema.filter(direct);",
			"const third = Schema.filter(declared);",
		].join("\n");
		const result = runTransform(source);

		expect(result.reports).toEqual([
			"[schema-filters] transformed apps/app-backend/src/fixture.ts (3 occurrences, 0 messages)",
		]);
		expect(result.output).toContain("Schema.makeFilter(inferred)");
		expect(result.output).toContain("Schema.makeFilter(direct)");
		expect(result.output).toContain("Schema.makeFilter(declared)");
	});

	test("atomically rejects unsupported callbacks and call shapes", async () => {
		const input = await readFixture("unsupported.input.ts");
		const expected = await readFixture("unsupported.output.ts");
		expect(runTransform(input)).toEqual({
			output: expected,
			reports: [
				"[schema-filters] warning: skipped apps/app-backend/src/fixture.ts: unsupported Schema.filter unresolved callback",
			],
		});

		for (const [prelude, expression, reason] of [
			["", 'Schema["filter"]((value) => true)', "computed Schema.filter"],
			["", "Schema?.filter((value) => true)", "optional Schema.filter"],
			["", "Schema.filter?.((value) => true)", "optional Schema.filter"],
			["", "Schema.filter", "Schema.filter usage"],
			["", "Schema.filter(...values)", "Schema.filter spread arguments"],
			["", "Schema.filter<string>((value) => true)", "Schema.filter type arguments"],
			["", "Schema.filter()", "Schema.filter argument count"],
			["", "Schema.filter((value) => true, {}, {})", "Schema.filter argument count"],
			["", "Schema.filter(getPredicate())", "Schema.filter unresolved callback"],
			["", "Schema.filter(predicates.valid)", "Schema.filter unresolved callback"],
			[
				"const predicate = importedPredicate;\n",
				"Schema.filter(predicate)",
				"Schema.filter unresolved callback",
			],
			[
				"let predicate = (value: string) => value.length > 0;\n",
				"Schema.filter(predicate)",
				"Schema.filter mutable callback",
			],
			[
				"function predicate(value: string) { return value.length > 0; }\npredicate = () => true;\n",
				"Schema.filter(predicate)",
				"Schema.filter reassigned callback",
			],
			[
				"",
				'Schema.filter((value): value is string => typeof value === "string")',
				"Schema.filter type-predicate callback",
			],
			[
				'const predicate = (value: unknown): value is string => typeof value === "string";\n',
				"Schema.filter(predicate)",
				"Schema.filter type-predicate callback",
			],
			[
				'const predicate: (value: unknown) => value is string = (value) => typeof value === "string";\n',
				"Schema.filter(predicate)",
				"Schema.filter annotated callback",
			],
			[
				'type Guard = (value: unknown) => value is string;\nconst predicate: Guard = (value) => typeof value === "string";\n',
				"Schema.filter(predicate)",
				"Schema.filter annotated callback",
			],
			[
				'namespace Guards { export type Guard = (value: unknown) => value is string; }\nconst predicate: Guards.Guard = (value) => typeof value === "string";\n',
				"Schema.filter(predicate)",
				"Schema.filter annotated callback",
			],
			[
				'import type { Guard } from "./guards";\nconst predicate: Guard = (value) => typeof value === "string";\n',
				"Schema.filter(predicate)",
				"Schema.filter annotated callback",
			],
			[
				'type Guard = (value: unknown) => boolean;\n{ type Guard = (value: unknown) => value is string; const predicate: Guard = (value) => typeof value === "string";\n',
				"Schema.filter(predicate)\n}",
				"Schema.filter annotated callback",
			],
			[
				'type Guard = (value: unknown) => boolean;\n{ type Guard = (value: unknown) => value is string; }\nconst predicate: Guard = (value) => typeof value === "string";\n',
				"Schema.filter(predicate)",
				"Schema.filter annotated callback",
			],
			[
				'type Guard = (value: unknown) => value is string;\nconst predicate: Guard & { readonly safe: true } = (value) => typeof value === "string";\n',
				"Schema.filter(predicate)",
				"Schema.filter annotated callback",
			],
			[
				'type Guard = (value: unknown) => value is string;\nconst predicate: Guard | ((value: unknown) => boolean) = (value) => typeof value === "string";\n',
				"Schema.filter(predicate)",
				"Schema.filter annotated callback",
			],
			[
				'const predicate: (value: unknown) => value is string = (value) => typeof value === "string";\nconst alias = predicate;\n',
				"Schema.filter(alias)",
				"Schema.filter unresolved callback",
			],
			["", "Schema.filter(() => true)", "Schema.filter callback parameter count"],
			[
				"",
				'Schema.filter((value, options) => options.errors === "all")',
				"Schema.filter callback parameter count",
			],
			[
				"",
				"Schema.filter((...values) => values.length > 0)",
				"Schema.filter rest-parameter callback",
			],
			["", "Schema.filter((value) => true, annotations)", "Schema.filter dynamic annotations"],
			[
				"",
				'Schema.filter((value) => true, { message: () => { return "invalid"; } })',
				"Schema.filter unsupported message callback",
			],
			[
				"",
				'Schema.filter((value) => true, { message: (value) => "invalid" })',
				"Schema.filter unsupported message callback",
			],
			[
				"",
				'Schema.filter((value) => true, { message: "first", message: () => "second" })',
				"Schema.filter duplicate message annotation",
			],
			[
				"",
				'Schema.filter((value) => true, { ["message"]: () => "invalid" })',
				"Schema.filter unsupported annotation property",
			],
			[
				"",
				"Schema.filter((value) => true, { ...annotations })",
				"Schema.filter unsupported annotation property",
			],
		] as const) {
			const source = `import { Schema } from "effect";\n${prelude}const valid = Schema.filter((value) => true);\nconst value = ${expression};\n`;
			expect(runTransform(source)).toEqual({
				output: source,
				reports: [
					`[schema-filters] warning: skipped apps/app-backend/src/fixture.ts: unsupported ${reason}`,
				],
			});
		}
	});

	test("beta filters preserve unannotated boolean and string behavior", () => {
		let legacyCalls = 0;
		let betaCalls = 0;
		const legacy = SchemaV3.String.pipe(
			SchemaV3.filter((value) => {
				legacyCalls += 1;
				return value.length > 0;
			}),
		);
		const beta = Schema.String.check(
			Schema.makeFilter((value) => {
				betaCalls += 1;
				return value.length > 0;
			}),
		);

		for (const value of ["valid", ""]) {
			expect(SchemaV3.is(legacy)(value)).toBe(Schema.is(beta)(value));
		}
		expect(legacyCalls).toBe(2);
		expect(betaCalls).toBe(2);

		const legacyOutput = SchemaV3.String.pipe(
			SchemaV3.filter((value) => value === "valid" || "output message"),
		);
		const betaOutput = Schema.String.check(
			Schema.makeFilter((value) => value === "valid" || "output message"),
		);
		expect(() => SchemaV3.decodeUnknownSync(legacyOutput)("invalid")).toThrow("output message");
		expect(() => Schema.decodeUnknownSync(betaOutput)("invalid")).toThrow("output message");
	});

	test("lazy message wrappers preserve v3 runtime behavior", () => {
		for (const output of [
			false,
			"predicate message",
			new ParseResultV3.Type(SchemaV3.String.ast, "invalid", "issue message"),
		]) {
			let legacyMessages = 0;
			let betaMessages = 0;
			let legacyPredicates = 0;
			let betaPredicates = 0;
			const legacy = SchemaV3.String.pipe(
				SchemaV3.filter(
					(input) => {
						legacyPredicates += 1;
						return input === "valid" || output;
					},
					{
						message: () => {
							legacyMessages += 1;
							return "custom message";
						},
					},
				),
			);
			const beta = Schema.String.check(
				Schema.makeFilter((input) => {
					const predicateOutput = ((value: string) => {
						betaPredicates += 1;
						return value === "valid" || output;
					})(input);
					return predicateOutput === true || predicateOutput === undefined
						? predicateOutput
						: (() => {
								betaMessages += 1;
								return "custom message";
							})();
				}),
			);

			expect(legacyMessages).toBe(0);
			expect(betaMessages).toBe(0);
			expect(SchemaV3.decodeUnknownSync(legacy)("valid")).toBe("valid");
			expect(Schema.decodeUnknownSync(beta)("valid")).toBe("valid");
			expect(() => SchemaV3.decodeUnknownSync(legacy)("invalid")).toThrow("custom message");
			expect(() => Schema.decodeUnknownSync(beta)("invalid")).toThrow("custom message");
			expect(legacyPredicates).toBe(2);
			expect(betaPredicates).toBe(2);
			expect(legacyMessages).toBe(1);
			expect(betaMessages).toBe(1);
		}
	});

	test("message thunk exceptions remain lazy", () => {
		let legacyPredicates = 0;
		let betaPredicates = 0;
		const legacy = SchemaV3.String.pipe(
			SchemaV3.filter(
				(value) => {
					legacyPredicates += 1;
					return value.length > 0;
				},
				{
					message: () => {
						throw new Error("message failure");
					},
				},
			),
		);
		const beta = Schema.String.check(
			Schema.makeFilter((input) => {
				const output = ((value: string) => {
					betaPredicates += 1;
					return value.length > 0;
				})(input);
				return output === true || output === undefined
					? output
					: (() => {
							throw new Error("message failure");
						})();
			}),
		);

		expect(SchemaV3.decodeUnknownSync(legacy)("valid")).toBe("valid");
		expect(Schema.decodeUnknownSync(beta)("valid")).toBe("valid");
		expect(legacyPredicates).toBe(1);
		expect(betaPredicates).toBe(1);
		let legacyFailure: unknown;
		let betaFailure: unknown;
		try {
			SchemaV3.decodeUnknownSync(legacy)("");
		} catch (error) {
			legacyFailure = error;
		}
		try {
			Schema.decodeUnknownSync(beta)("");
		} catch (error) {
			betaFailure = error;
		}
		let legacyMessageFailure: unknown;
		try {
			String(legacyFailure);
		} catch (error) {
			legacyMessageFailure = error;
		}
		expect(legacyMessageFailure instanceof Error && legacyMessageFailure.message).toBe(
			"message failure",
		);
		expect(betaFailure instanceof Error && betaFailure.message).toBe("message failure");
		expect(legacyPredicates).toBe(2);
		expect(betaPredicates).toBe(2);
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
				reports: [`[schema-filters] warning: skipped ${path}: outside lexical scope`],
			});
		}
	});
});

test("guard reports owned legacy filter with lexical parity and ignores filterEffect", async () => {
	const source = [
		'import { Schema as S } from "effect";',
		'import { Schema as OtherSchema } from "other";',
		"const direct = S.filter((value) => true);",
		'const computed = S["filter"]((value) => true);',
		"const effectful = S.filterEffect((value) => Effect.succeed(true));",
		"const other = OtherSchema.filter((value) => true);",
		"const shadowed = (S: any) => S.filter((value: string) => true);",
		"for (const S of schemas) S.filter((value: string) => true);",
	].join("\n");
	const path = "apps/app-backend/src/fixture.ts";

	expect((await scanSource(path, source)).map(formatViolation)).toEqual([
		`${path}:3: Schema.filter`,
		`${path}:4: Schema.filter`,
	]);

	const transformed = runTransform(
		'import { Schema as S } from "effect";\nconst value = S.String.pipe(S.filter((value) => true));\n',
		path,
	);
	expect((await scanSource(path, transformed.output ?? "")).map(formatViolation)).toEqual([]);
});
