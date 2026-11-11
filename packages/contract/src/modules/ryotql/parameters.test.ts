import { describe, expect, it } from "bun:test";

import { Result, Schema } from "effect";

import type { AppSchema } from "../../schema/property-schema";
import { bindArguments, ParameterSchema } from "./parameters";

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
