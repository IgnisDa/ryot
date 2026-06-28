import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { describe, expect, it } from "vitest";

import script from "./user-bootstrap.sandbox";

describe("media user bootstrap", () => {
	it("ensures the empty Library entity through one batch call", async () => {
		const calls: Array<unknown> = [];
		const result = await Effect.runPromise(
			script.run(
				{},
				{
					ensureUserEntities: (items) => {
						calls.push(items);
						return Effect.succeed([{ wasInserted: true, entityId: "library-id" }]);
					},
				},
				{ metadata: {}, sandboxScriptId: "script-id" },
			),
		);

		expect(calls).toEqual([[{ properties: {}, name: "Library", entitySchemaSlug: "library" }]]);
		expect(result).toEqual({ results: [{ wasInserted: true, entityId: "library-id" }] });
	});
});
