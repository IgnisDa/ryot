import { describe, expect, it } from "@effect/vitest";
import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import { execution } from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./resolve-episodes.sandbox";

const rowsResponse = (entityIds: string[]) => ({
	data: {
		episodes: {
			type: "rows" as const,
			items: entityIds.map((entityId) => ({ entityId })),
			pageInfo: { limit: 2, hasMore: false, nextCursor: null },
		},
	},
});

const createHost = (responses: string[][]) => {
	const documents: RyotQLDocument[] = [];
	return {
		documents,
		host: defineSandboxTestHost(manifest, {
			executeRyotql: (document) =>
				Effect.sync(() => {
					documents.push(document);
					return rowsResponse(responses[documents.length - 1] ?? []);
				}),
		}),
	};
};

const showRef = {
	index: 0,
	kind: "show",
	seasonNumber: 2,
	episodeNumber: 3,
	showEntityId: "show-1",
} as const;
const seasonRef = {
	index: 0,
	seasonNumber: 2,
	kind: "show-season",
	showEntityId: "show-1",
} as const;
const podcastRef = {
	index: 0,
	kind: "podcast",
	episodeNumber: 7,
	podcastEntityId: "podcast-1",
} as const;
const podcastTitleRef = {
	index: 0,
	kind: "podcast-title",
	episodeTitle: "Pilot",
	podcastEntityId: "podcast-1",
} as const;

describe("resolve episodes operation", () => {
	it.live("builds a relational show query with explicit episode, season, and show joins", () =>
		Effect.gen(function* () {
			const { host, documents } = createHost([["episode-1"]]);

			expect(yield* runSandboxTestScript(definition, { refs: [showRef] }, host, execution)).toEqual(
				{ results: [{ index: 0, entityId: "episode-1" }] },
			);
			const query = documents[0]?.queries["episodes"];
			expect(query).toMatchObject({
				from: { table: "entity", alias: "episode" },
				output: { type: "rows", pagination: { limit: 2 } },
			});
			expect(
				query?.joins?.map((join) => (join.type === "jsonElements" ? join.alias : join.table.alias)),
			).toEqual(["seasonEpisode", "season", "showSeason", "show"]);
		}),
	);

	it.live("builds a relational podcast query with the podcast episode join", () =>
		Effect.gen(function* () {
			const { host, documents } = createHost([["episode-9"]]);

			expect(
				yield* runSandboxTestScript(definition, { refs: [podcastRef] }, host, execution),
			).toEqual({ results: [{ index: 0, entityId: "episode-9" }] });
			const query = documents[0]?.queries["episodes"];
			expect(
				query?.joins?.map((join) => (join.type === "jsonElements" ? join.alias : join.table.alias)),
			).toEqual(["podcastEpisode", "podcast"]);
		}),
	);

	it.live("resolves a podcast episode by exact title within its podcast", () =>
		Effect.gen(function* () {
			const { host, documents } = createHost([["episode-1"]]);

			expect(
				yield* runSandboxTestScript(definition, { refs: [podcastTitleRef] }, host, execution),
			).toEqual({ results: [{ index: 0, entityId: "episode-1" }] });
			const query = documents[0]?.queries["episodes"];
			expect(query?.where).toMatchObject({
				type: "and",
				predicates: expect.arrayContaining([
					{
						type: "and",
						predicates: expect.arrayContaining([
							{
								operator: "eq",
								type: "comparison",
								right: { type: "literal", value: "podcast" },
								left: { type: "column", tableAlias: "podcast", field: "entitySchemaSlug" },
							},
						]),
					},
					{
						type: "and",
						predicates: expect.arrayContaining([
							{
								operator: "eq",
								type: "comparison",
								right: { type: "literal", value: "podcast-episode" },
								left: { type: "column", tableAlias: "episode", field: "entitySchemaSlug" },
							},
						]),
					},
					{
						type: "and",
						predicates: expect.arrayContaining([
							{
								operator: "eq",
								type: "comparison",
								right: { type: "literal", value: "podcast-to-podcast-episode" },
								left: {
									type: "column",
									tableAlias: "podcastEpisode",
									field: "relationshipSchemaSlug",
								},
							},
						]),
					},
					{
						operator: "eq",
						type: "comparison",
						right: { value: "Pilot", type: "literal" },
						left: { field: "name", type: "column", tableAlias: "episode" },
					},
					{
						operator: "eq",
						type: "comparison",
						right: { type: "literal", value: "podcast-1" },
						left: { field: "id", type: "column", tableAlias: "podcast" },
					},
				]),
			});
		}),
	);

	it.live("returns no podcast-title match for missing or ambiguous titles", () =>
		Effect.gen(function* () {
			const { host } = createHost([[], ["episode-2", "episode-3"]]);

			expect(
				yield* runSandboxTestScript(
					definition,
					{ refs: [podcastTitleRef, { ...podcastTitleRef, index: 1 }] },
					host,
					execution,
				),
			).toEqual({
				results: [
					{ index: 0, entityId: null },
					{ index: 1, entityId: null },
				],
			});
		}),
	);

	it.live("builds a relational show season query", () =>
		Effect.gen(function* () {
			const { host, documents } = createHost([["season-2"]]);

			expect(
				yield* runSandboxTestScript(definition, { refs: [seasonRef] }, host, execution),
			).toEqual({ results: [{ index: 0, entityId: "season-2" }] });
			const query = documents[0]?.queries["episodes"];
			expect(query).toMatchObject({
				from: { alias: "season", table: "entity" },
				output: { type: "rows", pagination: { limit: 2 } },
			});
			expect(
				query?.joins?.map((join) => (join.type === "jsonElements" ? join.alias : join.table.alias)),
			).toEqual(["showSeason", "show"]);
		}),
	);

	it.live("emits documents accepted by the RyotQL contract", () =>
		Effect.gen(function* () {
			const { host, documents } = createHost([[], []]);

			yield* runSandboxTestScript(
				definition,
				{ refs: [showRef, { ...podcastRef, index: 1 }] },
				host,
				execution,
			);
			for (const document of documents) {
				expect(Schema.is(RyotQLDocument)(document)).toBe(true);
			}
		}),
	);

	it.live("resolves only unique matches and echoes each caller index with its own result", () =>
		Effect.gen(function* () {
			const { host, documents } = createHost([
				["episode-1"],
				[],
				["episode-2", "episode-3"],
				["episode-4"],
				["episode-5"],
			]);

			expect(
				yield* runSandboxTestScript(
					definition,
					{
						refs: [
							{ ...showRef, index: 7 },
							{ ...showRef, index: 4, episodeNumber: 99 },
							{ ...podcastRef, index: 2, episodeNumber: 1 },
							{ ...podcastRef, index: 9 },
							{ ...podcastTitleRef, index: 11 },
						],
					},
					host,
					execution,
				),
			).toEqual({
				results: [
					{ index: 7, entityId: "episode-1" },
					{ index: 4, entityId: null },
					{ index: 2, entityId: null },
					{ index: 9, entityId: "episode-4" },
					{ index: 11, entityId: "episode-5" },
				],
			});
			expect(documents).toHaveLength(5);
		}),
	);
});
