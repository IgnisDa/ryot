import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import script, { manifest } from "./user-bootstrap.sandbox";

describe("fitness user bootstrap", () => {
	it("ensures the empty Fitness Library entity through one batch call", () => {
		const calls: Array<unknown> = [];
		return Effect.runPromise(
			script
				.run(
					{},
					defineSandboxTestHost(manifest, {
						ensureUserEntities: (items) => {
							calls.push(items);
							return Effect.succeed([{ wasInserted: true, entityId: "fitness-library-id" }]);
						},
					}),
				)
				.pipe(
					Effect.map((result) => {
						expect(calls).toEqual([
							[{ properties: {}, name: "Fitness Library", entitySchemaSlug: "fitness-library" }],
						]);
						expect(result).toEqual({
							results: [{ wasInserted: true, entityId: "fitness-library-id" }],
						});
						return result;
					}),
				),
		);
	});
});
