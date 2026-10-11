import { describe, expect, it } from "@effect/vitest";
import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { TestClock } from "effect/testing";

import definition, { manifest } from "./media-trending-rankings.sandbox";

const execution = { metadata: {}, sandboxScriptId: "script-test" };

const runRankings = (batches: Parameters<typeof definition.run>[0]["batches"]) => {
	const writes: Parameters<ScriptHost["upsertGlobalRelationships"]>[0][] = [];
	const host = defineSandboxTestHost(manifest, {
		upsertGlobalRelationships: (groups) =>
			Effect.sync(() => {
				writes.push(groups);
				return groups.map(({ relationships }) => ({ deleted: 0, upserted: relationships.length }));
			}),
	});
	return runSandboxTestScript(definition, { batches }, host, execution).pipe(
		Effect.map((result) => ({ result, writes })),
	);
};

describe("media trending rankings", () => {
	it.effect("writes one self group ranking each schema from 1 with the clock's fetchedAt", () =>
		Effect.gen(function* () {
			const fetchedAt = "2026-01-01T12:00:00.000Z";
			yield* TestClock.setTime(Date.parse(fetchedAt));
			const { result, writes } = yield* runRankings([
				{ entitySchemaSlug: "movie", entityIds: ["movie-a", "movie-b"] },
				{ entityIds: ["show-a"], entitySchemaSlug: "show" },
			]);
			expect(result).toEqual({ synced: true, itemCount: 3 });
			expect(writes).toEqual([
				[
					{
						selector: { type: "self" },
						relationshipSchemaSlug: "media-trending",
						relationships: [
							{
								sourceEntityId: "movie-a",
								targetEntityId: "movie-a",
								properties: { rank: 1, fetchedAt },
							},
							{
								sourceEntityId: "movie-b",
								targetEntityId: "movie-b",
								properties: { rank: 2, fetchedAt },
							},
							{
								sourceEntityId: "show-a",
								targetEntityId: "show-a",
								properties: { rank: 1, fetchedAt },
							},
						],
					},
				],
			]);
		}),
	);

	it.live("writes nothing when no provider produced a batch", () =>
		Effect.gen(function* () {
			const { result, writes } = yield* runRankings([]);
			expect(result).toEqual({ itemCount: 0, synced: false });
			expect(writes).toEqual([]);
		}),
	);
});
