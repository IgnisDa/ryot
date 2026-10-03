import { describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import script from "./user-bootstrap.sandbox";

describe("media user bootstrap", () => {
	it.live("ensures the empty Media Library entity through one batch call", () =>
		Effect.gen(function* () {
			const calls: Array<unknown> = [];
			const result = yield* script.run(
				{},
				{
					ensureUserEntities: (items) => {
						calls.push(items);
						return Effect.succeed([{ wasInserted: true, entityId: "library-id" }]);
					},
				},
			);

			expect(calls).toEqual([
				[{ properties: {}, name: "Media Library", entitySchemaSlug: "media-library" }],
			]);
			expect(result).toEqual({ results: [{ wasInserted: true, entityId: "library-id" }] });
		}),
	);
});
