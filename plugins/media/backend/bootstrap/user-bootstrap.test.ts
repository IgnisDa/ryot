import { describe, expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import script, { manifest } from "./user-bootstrap.sandbox";

describe("media user bootstrap", () => {
	it.live(
		"ensures the empty Media Library entity through one batch call",
		() =>
			Effect.gen(function* () {
				const calls: Array<unknown> = [];
				const result = yield* script.run(
					{},
					defineSandboxTestHost(manifest, {
						ensureUserEntities: (items) => {
							calls.push(items);
							return Effect.succeed([{ wasInserted: true, entityId: "library-id" }]);
						},
					}),
				);

				expect(calls).toEqual([
					[{ properties: {}, name: "Media Library", entitySchemaSlug: "media-library" }],
				]);
				expect(result).toEqual({ results: [{ wasInserted: true, entityId: "library-id" }] });
			}),
		testTimeout,
	);
});
