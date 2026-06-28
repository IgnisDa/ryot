import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

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

describe("resolve episodes operation", () => {
	it("builds a relational show query with explicit episode, season, and show joins", async () => {
		const { host, documents } = createHost([["episode-1"]]);

		await expect(
			Effect.runPromise(runSandboxTestScript(definition, { refs: [showRef] }, host, execution)),
		).resolves.toEqual({ results: [{ index: 0, entityId: "episode-1" }] });
		const query = documents[0]?.queries["episodes"];
		expect(query).toMatchObject({
			from: { table: "entity", alias: "episode" },
			output: { type: "rows", pagination: { limit: 2 } },
		});
		expect(query?.joins?.map((join) => join.table.alias)).toEqual([
			"seasonEpisode",
			"season",
			"showSeason",
			"show",
		]);
	});

	it("builds a relational podcast query with the podcast episode join", async () => {
		const { host, documents } = createHost([["episode-9"]]);

		await expect(
			Effect.runPromise(runSandboxTestScript(definition, { refs: [podcastRef] }, host, execution)),
		).resolves.toEqual({ results: [{ index: 0, entityId: "episode-9" }] });
		const query = documents[0]?.queries["episodes"];
		expect(query?.joins?.map((join) => join.table.alias)).toEqual(["podcastEpisode", "podcast"]);
	});

	it("builds a relational show season query", async () => {
		const { host, documents } = createHost([["season-2"]]);

		await expect(
			Effect.runPromise(runSandboxTestScript(definition, { refs: [seasonRef] }, host, execution)),
		).resolves.toEqual({ results: [{ index: 0, entityId: "season-2" }] });
		const query = documents[0]?.queries["episodes"];
		expect(query).toMatchObject({
			from: { alias: "season", table: "entity" },
			output: { type: "rows", pagination: { limit: 2 } },
		});
		expect(query?.joins?.map((join) => join.table.alias)).toEqual(["showSeason", "show"]);
	});

	it("emits documents accepted by the RyotQL contract", async () => {
		const { host, documents } = createHost([[], []]);

		await Effect.runPromise(
			runSandboxTestScript(
				definition,
				{ refs: [showRef, { ...podcastRef, index: 1 }] },
				host,
				execution,
			),
		);
		for (const document of documents) {
			expect(Schema.is(RyotQLDocument)(document)).toBe(true);
		}
	});

	it("resolves only unique matches and echoes each caller index with its own result", async () => {
		const { host, documents } = createHost([
			["episode-1"],
			[],
			["episode-2", "episode-3"],
			["episode-4"],
		]);

		await expect(
			Effect.runPromise(
				runSandboxTestScript(
					definition,
					{
						refs: [
							{ ...showRef, index: 7 },
							{ ...showRef, index: 4, episodeNumber: 99 },
							{ ...podcastRef, index: 2, episodeNumber: 1 },
							{ ...podcastRef, index: 9 },
						],
					},
					host,
					execution,
				),
			),
		).resolves.toEqual({
			results: [
				{ index: 7, entityId: "episode-1" },
				{ index: 4, entityId: null },
				{ index: 2, entityId: null },
				{ index: 9, entityId: "episode-4" },
			],
		});
		expect(documents).toHaveLength(4);
	});
});
