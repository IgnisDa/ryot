import { describe, expect, it } from "bun:test";

import { Result, Schema } from "effect";

import type { AppSchema } from "../../schema/property-schema";
import { bindArguments, bindPartialArguments, ParameterSchema } from "./parameters";

const text = { label: "Text", type: "string", description: "Search text" } as const;

describe("query parameter declarations and arguments", () => {
	it("applies defaults and conditional requirements while rejecting unknown and mistyped values", () => {
		const schema: AppSchema = {
			rules: [
				{
					path: ["search"],
					kind: "validation",
					validation: { required: true },
					when: { value: true, operator: "eq", path: ["enabled"] },
				},
			],
			fields: {
				search: text,
				enabled: {
					type: "boolean",
					label: "Enabled",
					defaultValue: false,
					description: "Enable selection",
				},
				limit: {
					label: "Limit",
					type: "integer",
					defaultValue: 5,
					description: "Result limit",
					validation: { minimum: 1, maximum: 10 },
				},
			},
		};
		expect(Result.getOrThrow(bindArguments(schema, {}))).toEqual({ limit: 5, enabled: false });
		for (const input of [{ unknown: 1 }, { limit: 0 }, { limit: "5" }, { enabled: true }]) {
			expect(Result.isFailure(bindArguments(schema, input))).toBe(true);
		}
		expect(Result.getOrThrow(bindArguments(schema, { enabled: true, search: "sample" }))).toEqual({
			limit: 5,
			enabled: true,
			search: "sample",
		});
	});
	it("rejects unsupported parameter types and invalid definitions at any array depth", () => {
		const invalid = [
			{ ...text, secret: true },
			{ ...text, format: { kind: "upload", allowedFileExtensions: ["csv"] } },
			{ ...text, format: { provider: "provider", kind: "oauth-connection" } },
			{ ...text, type: "object", properties: {} },
			{ ...text, type: "enum", choices: { kind: "dynamic", source: "choices" } },
			{ ...text, type: "array", items: { ...text, properties: {}, type: "object" } },
			{ ...text, type: "integer", defaultValue: -1, validation: { minimum: 0 } },
		];
		for (const property of invalid) {
			expect(
				Result.isFailure(Schema.decodeResult(ParameterSchema)({ fields: { value: property } })),
			).toBe(true);
		}
		expect(
			Result.isFailure(
				Schema.decodeResult(ParameterSchema)({
					fields: { value: text },
					rules: [
						{
							path: ["value"],
							kind: "validation",
							validation: { required: true },
							when: { value: "x", operator: "eq", path: ["missing"] },
						},
					],
				}),
			),
		).toBe(true);
	});
	it("accepts entity sources and static lists, and preserves explicit null for optional arguments", () => {
		const schema: AppSchema = {
			fields: {
				ids: { ...text, items: text, type: "array" },
				source: { ...text, validation: { required: true }, reference: { kind: "entity-source" } },
			},
		};
		expect(Result.getOrThrow(bindArguments(schema, { ids: null, source: "selection" }))).toEqual({
			ids: null,
			source: "selection",
		});
		expect(Result.isFailure(bindArguments(schema, { ids: [] }))).toBe(true);
	});
	it("permits required event references in parameter declarations", () => {
		expect(
			Result.isSuccess(
				Schema.decodeResult(ParameterSchema)({
					fields: {
						event: { ...text, validation: { required: true }, reference: { kind: "event-id" } },
					},
				}),
			),
		).toBe(true);
	});
});

describe("partial owner argument bindings", () => {
	const schema: AppSchema = {
		rules: [
			{
				path: ["search"],
				kind: "validation",
				validation: { required: true },
				when: { value: true, operator: "eq", path: ["enabled"] },
			},
		],
		fields: {
			search: text,
			enabled: { ...text, type: "boolean", defaultValue: false },
			source: { ...text, validation: { required: true }, reference: { kind: "entity-source" } },
			limit: { ...text, type: "integer", defaultValue: 5, validation: { minimum: 1, maximum: 10 } },
		},
	};

	it("leaves absent values unbound and validates the merged arguments at execution", () => {
		const bindings = Result.getOrThrow(bindPartialArguments(schema, { enabled: true }));
		expect(bindings).toEqual({ enabled: true });
		expect(Result.isFailure(bindArguments(schema, bindings))).toBe(true);
		expect(
			Result.getOrThrow(bindArguments(schema, { ...bindings, search: "x", source: "selection" })),
		).toEqual({ limit: 5, search: "x", enabled: true, source: "selection" });
		expect(Result.getOrThrow(bindPartialArguments(schema))).toEqual({});
	});

	it("preserves explicit nulls and defaults without accepting invalid supplied bindings", () => {
		expect(Result.getOrThrow(bindPartialArguments(schema, { limit: 5, search: null }))).toEqual({
			limit: 5,
			search: null,
		});
		for (const input of [
			null,
			[],
			{ unknown: 1 },
			{ limit: 0 },
			{ limit: "5" },
			{ source: null },
			{ search: null, enabled: true },
		]) {
			expect(Result.isFailure(bindPartialArguments(schema, input))).toBe(true);
		}
		expect(Result.isFailure(bindPartialArguments(undefined, { source: "selection" }))).toBe(true);
		expect(
			Result.isFailure(bindPartialArguments({ fields: { invalid: { ...text, secret: true } } })),
		).toBe(true);
	});

	it("uses existing visibility rules and value normalization", () => {
		const definition: AppSchema = {
			fields: {
				hidden: text,
				enabled: { ...text, type: "boolean", defaultValue: false },
				amount: { ...text, type: "number", normalize: { round: { scale: 1 } } },
			},
			rules: [
				{
					path: ["hidden"],
					kind: "visibility",
					visibility: { hidden: true },
					when: { value: false, operator: "eq", path: ["enabled"] },
				},
			],
		};
		expect(Result.isFailure(bindPartialArguments(definition, { hidden: "x" }))).toBe(true);
		expect(
			Result.getOrThrow(
				bindPartialArguments(definition, { hidden: "x", amount: 1.24, enabled: true }),
			),
		).toEqual({ hidden: "x", amount: 1.2, enabled: true });
	});
});
