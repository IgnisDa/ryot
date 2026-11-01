import { describe, expect, it } from "@effect/vitest";
import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { requireRowsQuery, rowsResponse } from "@ryot-app/ryotql-recipes/test-utils";
import { TestClock } from "effect/testing";

import { ryotqlDocumentNodes } from "../../tests/ryotql-test-utils";
import definition, { manifest } from "./media-trending-rankings.sandbox";

const execution = { metadata: {}, sandboxScriptId: "script-test" };

const mediaRow = (id: string, rank: number, fetchedAt: string) => ({
	id,
	rank,
	fetchedAt,
	images: null,
	schemaSlug: "show",
	name: `Media ${id}`,
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
});

type Input = Parameters<typeof definition.run>[0];

const runRankings = (
	batches: Input["batches"],
	failedEntitySchemaSlugs: Input["failedEntitySchemaSlugs"] = [],
	pages: readonly unknown[] = [],
) => {
	const writes: Parameters<ScriptHost["upsertGlobalRelationships"]>[0][] = [];
	const documents: Parameters<ScriptHost["executeRyotql"]>[0][] = [];
	const host = defineSandboxTestHost(manifest, {
		upsertGlobalRelationships: (groups) =>
			Effect.sync(() => {
				writes.push(groups);
				return groups.map(({ relationships }) => ({ deleted: 0, upserted: relationships.length }));
			}),
		executeRyotql: (document) =>
			Effect.sync(() => {
				documents.push(document);
				return (
					pages[documents.length - 1] ??
					rowsResponse("trending", [], { limit: 100, hasMore: false, nextCursor: null })
				);
			}),
	});
	return runSandboxTestScript(
		definition,
		{ batches, failedEntitySchemaSlugs },
		host,
		execution,
	).pipe(Effect.map((result) => ({ result, writes, documents })));
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

	it.effect("carries a failed schema's latest rows across pages beside the new batch", () =>
		Effect.gen(function* () {
			const fetchedAt = "2026-01-02T12:00:00.000Z";
			const previous = "2026-01-01T12:00:00.000Z";
			yield* TestClock.setTime(Date.parse(fetchedAt));
			const { result, writes, documents } = yield* runRankings(
				[{ entityIds: ["movie-a"], entitySchemaSlug: "movie" }],
				["show"],
				[
					rowsResponse("trending", [mediaRow("show-a", 1, previous)], {
						limit: 100,
						hasMore: true,
						nextCursor: "page-2",
					}),
					rowsResponse("trending", [mediaRow("show-b", 2, previous)], {
						limit: 100,
						hasMore: false,
						nextCursor: null,
					}),
				],
			);
			expect(result).toEqual({ synced: true, itemCount: 3 });
			expect(documents).toHaveLength(2);
			const outputs = documents.map(
				(document) => requireRowsQuery(document.queries["trending"]).output,
			);
			expect(outputs.map(({ pagination }) => pagination.limit)).toEqual([100, 100]);
			expect(outputs.map(({ pagination }) => pagination.after)).toEqual([undefined, "page-2"]);
			for (const document of documents) {
				const nodes = ryotqlDocumentNodes(document);
				expect(nodes).toContain("show");
				expect(nodes).not.toContain("movie");
			}
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
								sourceEntityId: "show-a",
								targetEntityId: "show-a",
								properties: { rank: 1, fetchedAt: previous },
							},
							{
								sourceEntityId: "show-b",
								targetEntityId: "show-b",
								properties: { rank: 2, fetchedAt: previous },
							},
						],
					},
				],
			]);
		}),
	);

	it.live("writes nothing and reads nothing when every provider failed", () =>
		Effect.gen(function* () {
			const { result, writes, documents } = yield* runRankings([], ["movie", "show"]);
			expect(result).toEqual({ itemCount: 0, synced: false });
			expect(documents).toEqual([]);
			expect(writes).toEqual([]);
		}),
	);
});
