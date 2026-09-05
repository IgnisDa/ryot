import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { describe, expect, it } from "vitest";

import script from "./user-bootstrap.sandbox";

describe("fitness user bootstrap", () => {
	it("ensures the empty Fitness Library entity through one batch call", async () => {
		const calls: Array<unknown> = [];
		const result = await Effect.runPromise(
			script.run(
				{},
				{
					ensureUserEntities: (items) => {
						calls.push(items);
						return Effect.succeed([{ wasInserted: true, entityId: "fitness-library-id" }]);
					},
				},
				{ metadata: {}, sandboxScriptId: "script-id" },
			),
		);

		expect(calls).toEqual([
			[{ properties: {}, name: "Fitness Library", entitySchemaSlug: "fitness-library" }],
		]);
		expect(result).toEqual({ results: [{ wasInserted: true, entityId: "fitness-library-id" }] });
	});
});
