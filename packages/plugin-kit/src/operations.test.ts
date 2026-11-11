import { describe, expect, it } from "bun:test";

import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";

import { defineOperationRecipe, invokeOperationRecipe, operationJsonSchema } from "./operations";

const recipe = defineOperationRecipe({
	operationSlug: "resolve-subparts",
	packageId: PluginPackageId.make("ryot/fixture"),
	input: Schema.Struct({ count: Schema.FiniteFromString }),
	output: Schema.Struct({ entityId: Schema.String, count: Schema.FiniteFromString }),
});

describe("invokeOperationRecipe", () => {
	it("encodes the input, forwards the request, and decodes the transport result", () => {
		const request: { payload: unknown; operationSlug: string; packageId: PluginPackageId }[] = [];
		const result = Effect.runSync(
			invokeOperationRecipe(recipe, { count: 3 }, (incoming) => {
				request.push(incoming);
				return Effect.succeed({ count: "4", entityId: "entity-1" });
			}),
		);

		expect(request).toEqual<unknown>([
			{ payload: { count: "3" }, packageId: "ryot/fixture", operationSlug: "resolve-subparts" },
		]);
		expect(result).toEqual({ count: 4, entityId: "entity-1" });
	});

	it("propagates input schema failures without invoking transport", () => {
		let invoked = false;

		expect(() =>
			Effect.runSync(
				invokeOperationRecipe(recipe, { count: Number.NaN }, () => {
					invoked = true;
					return Effect.succeed({ count: "4", entityId: "entity-1" });
				}),
			),
		).toThrow();
		expect(invoked).toBe(false);
	});

	it("fails when the transport result does not match the output schema", () => {
		expect(() =>
			Effect.runSync(
				invokeOperationRecipe(recipe, { count: 1 }, () => Effect.succeed({ entityId: 42 })),
			),
		).toThrow();
	});
});

describe("operationJsonSchema", () => {
	it("publishes structural constraints while runtime checks remain authoritative", () => {
		const input = Schema.Struct({
			end: Schema.Int,
			start: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
		}).check(Schema.makeFilter((value) => value.end >= value.start));
		expect(operationJsonSchema(input)).toMatchObject({
			type: "object",
			required: ["end", "start"],
			$schema: "https://json-schema.org/draft/2020-12/schema",
			properties: { end: { type: "integer" }, start: { minimum: 0, type: "integer" } },
		});
		expect(Schema.decodeResult(input)({ end: 1, start: 2 })._tag).toBe("Failure");
	});

	it("rejects opaque nested schemas instead of silently publishing an unconstrained input", () => {
		const opaque = Schema.declare<Date>((value) => value instanceof Date);
		expect(() => operationJsonSchema(Schema.Struct({ callback: opaque }))).toThrow(
			"Operation schema has no JSON representation: Declaration",
		);
		expect(() => operationJsonSchema(Schema.Struct({ count: Schema.BigInt }))).toThrow(
			"Operation schema has no JSON representation: BigInt",
		);
		expect(() => operationJsonSchema(Schema.Struct({ value: Schema.Literal(1n) }))).toThrow(
			"Operation schema has a non-JSON literal",
		);
	});

	it("supports JSON values and omitted optional values but rejects required undefined values", () => {
		expect(operationJsonSchema(Schema.Record(Schema.String, Schema.Json))).toMatchObject({
			type: "object",
		});
		expect(() =>
			operationJsonSchema(
				Schema.Struct({ value: Schema.optional(Schema.UndefinedOr(Schema.String)) }),
			),
		).not.toThrow();
		expect(() => operationJsonSchema(Schema.Struct({ value: Schema.Undefined }))).toThrow(
			"Operation schema has no JSON representation: Undefined",
		);
	});

	it("describes the wire side of a transformed schema and retains referenced definitions", () => {
		const count = Schema.FiniteFromString.annotate({ identifier: "Count" });
		expect(operationJsonSchema(Schema.Struct({ count }))).toMatchObject({
			type: "object",
			$defs: { CountEncoded: { type: "string" } },
			properties: { count: { $ref: "#/$defs/CountEncoded" } },
		});
	});
});
