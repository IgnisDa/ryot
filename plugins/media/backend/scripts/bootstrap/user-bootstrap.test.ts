import { Effect } from "@ryot/sandbox-sdk/effect";
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
						return Effect.succeed([{ entityId: "library-id", wasInserted: true }]);
					},
				},
				{ metadata: {}, sandboxScriptId: "script-id" },
			),
		);

		expect(calls).toEqual([[{ name: "Library", properties: {}, entitySchemaSlug: "library" }]]);
		expect(result).toEqual({
			results: [{ entityId: "library-id", wasInserted: true }],
		});
	});
});
