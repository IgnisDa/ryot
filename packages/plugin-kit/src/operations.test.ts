import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { defineOperationRecipe, invokeOperationRecipe } from "./operations";

const recipe = defineOperationRecipe({
	pluginSlug: "media",
	operationSlug: "resolve-episodes",
	input: Schema.Struct({ count: Schema.FiniteFromString }),
	output: Schema.Struct({ count: Schema.NumberFromString, entityId: Schema.String }),
});

describe("invokeOperationRecipe", () => {
	it("encodes the input, forwards the request, and decodes the transport result", () => {
		const request: { payload: unknown; pluginSlug: string; operationSlug: string }[] = [];
		const result = Effect.runSync(
			invokeOperationRecipe(recipe, { count: 3 }, (incoming) => {
				request.push(incoming);
				return Effect.succeed({ count: "4", entityId: "entity-1" });
			}),
		);

		expect(request).toEqual([
			{ payload: { count: "3" }, pluginSlug: "media", operationSlug: "resolve-episodes" },
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
