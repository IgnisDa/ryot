import { describe, expect } from "bun:test";

import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import {
	bindTestRequest,
	requireRowsQuery,
	rowsResponse,
} from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { TestClock } from "effect/testing";

import { ryotqlDocumentNodes } from "../../tests/ryotql-test-utils";
import { manifest } from "../providers/movie/tmdb/trending.sandbox";
import { trendingChanges } from "./trending";

const mediaRow = (id: string, rank: number, fetchedAt: string) => ({
	id,
	rank,
	fetchedAt,
	images: null,
	schemaSlug: "show",
	name: `Media ${id}`,
	isInMediaLibrary: false,
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
});

const upserted = (externalId: string) =>
	({ externalId, kind: "upserted", entitySchemaSlug: "movie" }) as const;

const existing = (entityId: string) =>
	({ kind: "existing", entityId: EntityId.make(entityId) }) as const;

const rank = (pages: readonly unknown[]) => {
	const documents: RyotQLDocument[] = [];
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: (document) =>
			Effect.sync(() => {
				documents.push(bindTestRequest(document));
				return (
					pages[documents.length - 1] ??
					rowsResponse("trending", [], { limit: 100, hasMore: false, nextCursor: null })
				);
			}),
	});
	return trendingChanges(host, "movie", [
		{ name: "First", externalId: "1" },
		{ name: "Second", externalId: "2" },
	]).pipe(Effect.map((changes) => ({ changes, documents })));
};

describe("trending changes", () => {
	it.effect(
		"upserts the batch and ranks it from 1 with the clock's fetchedAt",
		() =>
			Effect.gen(function* () {
				const fetchedAt = "2026-01-01T12:00:00.000Z";
				yield* TestClock.setTime(Date.parse(fetchedAt));
				const { changes, documents } = yield* rank([]);
				expect(changes).toEqual({
					globalEntities: [
						{
							name: "First",
							properties: {},
							externalId: "1",
							populatedAt: null,
							entitySchemaSlug: "movie",
						},
						{
							name: "Second",
							properties: {},
							externalId: "2",
							populatedAt: null,
							entitySchemaSlug: "movie",
						},
					],
					globalRelationships: [
						{
							selector: { type: "self" },
							relationshipSchemaSlug: "media-trending",
							relationships: [
								{
									source: upserted("1"),
									target: upserted("1"),
									properties: { rank: 1, fetchedAt },
								},
								{
									source: upserted("2"),
									target: upserted("2"),
									properties: { rank: 2, fetchedAt },
								},
							],
						},
					],
				});
				for (const document of documents) {
					const nodes = ryotqlDocumentNodes(document);
					expect(nodes).toContain("show");
					expect(nodes).not.toContain("movie");
				}
			}),
		testTimeout,
	);

	it.effect(
		"carries every other schema's latest batch across pages unchanged",
		() =>
			Effect.gen(function* () {
				const fetchedAt = "2026-01-02T12:00:00.000Z";
				const previous = "2026-01-01T12:00:00.000Z";
				yield* TestClock.setTime(Date.parse(fetchedAt));
				const { changes, documents } = yield* rank([
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
				]);
				expect(
					documents.map(
						(document) => requireRowsQuery(document.queries["trending"]).output.pagination.after,
					),
				).toEqual([undefined, "page-2"]);
				expect(changes.globalRelationships?.[0]?.relationships).toEqual([
					{ source: upserted("1"), target: upserted("1"), properties: { rank: 1, fetchedAt } },
					{ source: upserted("2"), target: upserted("2"), properties: { rank: 2, fetchedAt } },
					{
						source: existing("show-a"),
						target: existing("show-a"),
						properties: { rank: 1, fetchedAt: previous },
					},
					{
						source: existing("show-b"),
						target: existing("show-b"),
						properties: { rank: 2, fetchedAt: previous },
					},
				]);
			}),
		testTimeout,
	);
});
