import { describe, expect, it } from "bun:test";

import { Effect, Schema } from "effect";

import { defineOperationRecipe, invokeOperationRecipe } from "./operations";

const recipe = defineOperationRecipe({
	pluginSlug: "media",
	operationSlug: "resolve-episodes",
	output: Schema.Struct({ entityId: Schema.String }),
	input: Schema.Struct({ count: Schema.NumberFromString }),
});

describe("invokeOperationRecipe", () => {
	it("encodes the input, forwards the request, and decodes the transport result", () => {
		const request: { payload: unknown; pluginSlug: string; operationSlug: string }[] = [];
		const result = Effect.runSync(
			invokeOperationRecipe(recipe, { count: 3 }, (incoming) => {
				request.push(incoming);
				return Effect.succeed({ entityId: "entity-1" });
			}),
		);

		expect(request).toEqual([
			{ payload: { count: "3" }, pluginSlug: "media", operationSlug: "resolve-episodes" },
		]);
		expect(result).toEqual({ entityId: "entity-1" });
	});

	it("fails when the transport result does not match the output schema", () => {
		expect(() =>
			Effect.runSync(
				invokeOperationRecipe(recipe, { count: 1 }, () => Effect.succeed({ entityId: 42 })),
			),
		).toThrow();
	});
});
