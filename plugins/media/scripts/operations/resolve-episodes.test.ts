import { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { execution } from "../automations/automation-test-utils";
import definition, { manifest } from "./resolve-episodes.sandbox";

const rowsResponse = (entityIds: string[]) => ({
	data: {
		episodes: {
			items: entityIds.map((entityId) => ({
				entityId: { kind: "text" as const, value: entityId },
			})),
			pageInfo: { hasMore: false, limit: 2, page: 1, total: entityIds.length },
			type: "rows" as const,
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
const podcastRef = {
	index: 0,
	kind: "podcast",
	podcastEntityId: "podcast-1",
	episodeNumber: 7,
} as const;

describe("resolve episodes operation", () => {
	it("builds a relational show query with explicit episode, season, and show joins", async () => {
		const { documents, host } = createHost([["episode-1"]]);

		await expect(
			Effect.runPromise(runSandboxTestScript(definition, { refs: [showRef] }, host, execution)),
		).resolves.toEqual({ results: [{ index: 0, entityId: "episode-1" }] });
		const query = documents[0]?.queries["episodes"];
		expect(query).toMatchObject({
			from: { alias: "episode", table: "entity" },
			output: { pagination: { limit: 2, page: 1 }, type: "rows" },
		});
		expect(query?.joins?.map((join) => join.table.alias)).toEqual([
			"seasonEpisode",
			"season",
			"showSeason",
			"show",
		]);
	});

	it("builds a relational podcast query with the podcast episode join", async () => {
		const { documents, host } = createHost([["episode-9"]]);

		await expect(
			Effect.runPromise(runSandboxTestScript(definition, { refs: [podcastRef] }, host, execution)),
		).resolves.toEqual({ results: [{ index: 0, entityId: "episode-9" }] });
		const query = documents[0]?.queries["episodes"];
		expect(query?.joins?.map((join) => join.table.alias)).toEqual(["podcastEpisode", "podcast"]);
	});

	it("emits documents accepted by the RyotQL contract", async () => {
		const { documents, host } = createHost([[], []]);

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
		const { documents, host } = createHost([
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
