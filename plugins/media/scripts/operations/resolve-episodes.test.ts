import { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { describe, expect, it } from "vitest";

import { execution } from "../automations/automation-test-utils";
import { manifest, operation } from "./resolve-episodes.sandbox";

const episodeIdRef = {
	type: "ref",
	sourceAlias: "episode",
	field: { type: "system", name: "id" },
};

const rowsOutput = {
	type: "rows",
	pagination: { page: 1, limit: 2 },
	orderBy: [{ order: "asc", expr: episodeIdRef }],
	fields: [{ key: "entityId", expr: episodeIdRef }],
};

const rowsResponse = (entityIds: string[]) => ({
	type: "rows",
	data: {
		pageInfo: { page: 1, limit: 2, hasMore: false, total: entityIds.length },
		items: entityIds.map((entityId) => ({ entityId: { kind: "text", value: entityId } })),
	},
});

const createHost = (responses: string[][]) => {
	const documents: JsonValue[] = [];
	return {
		documents,
		host: defineSandboxTestHost(manifest, {
			executeQueryEngine: (document) =>
				Effect.sync(() => {
					documents.push(document);
					return rowsResponse(responses[documents.length - 1] ?? []);
				}),
		}),
	};
};

const showRef = {
	kind: "show",
	seasonNumber: 2,
	episodeNumber: 3,
	showEntityId: "show-1",
} as const;
const podcastRef = { kind: "podcast", podcastEntityId: "podcast-1", episodeNumber: 7 } as const;

describe("resolve episodes operation", () => {
	it("pushes the show season and episode filters into one query document", async () => {
		const { documents, host } = createHost([["episode-1"]]);

		await expect(
			Effect.runPromise(runSandboxTestDriver(operation, { refs: [showRef] }, host, execution)),
		).resolves.toEqual({ results: [{ entityId: "episode-1" }] });
		expect(documents[0]).toEqual({
			output: rowsOutput,
			source: {
				type: "entities",
				alias: "episode",
				schemas: ["show-episode"],
				where: {
					type: "and",
					values: [
						{
							operator: "eq",
							type: "comparison",
							right: { type: "literal", value: 3 },
							left: {
								type: "ref",
								sourceAlias: "episode",
								field: { type: "property", schema: "show-episode", path: ["episodeNumber"] },
							},
						},
						{
							type: "exists",
							source: {
								alias: "season",
								type: "entities",
								schemas: ["show-season"],
								via: {
									entityRef: "episode",
									direction: "incoming",
									alias: "seasonEpisodeEdge",
									schema: "show-season-to-show-episode",
								},
								where: {
									type: "and",
									values: [
										{
											operator: "eq",
											type: "comparison",
											right: { type: "literal", value: 2 },
											left: {
												type: "ref",
												sourceAlias: "season",
												field: { type: "property", schema: "show-season", path: ["seasonNumber"] },
											},
										},
										{
											type: "exists",
											source: {
												alias: "show",
												type: "entities",
												schemas: ["show"],
												via: {
													entityRef: "season",
													direction: "incoming",
													alias: "showSeasonEdge",
													schema: "show-to-show-season",
												},
												where: {
													operator: "eq",
													type: "comparison",
													right: { type: "literal", value: "show-1" },
													left: {
														type: "ref",
														sourceAlias: "show",
														field: { type: "system", name: "id" },
													},
												},
											},
										},
									],
								},
							},
						},
					],
				},
			},
		});
	});

	it("pushes the podcast episode filter into one query document", async () => {
		const { documents, host } = createHost([["episode-9"]]);

		await expect(
			Effect.runPromise(runSandboxTestDriver(operation, { refs: [podcastRef] }, host, execution)),
		).resolves.toEqual({ results: [{ entityId: "episode-9" }] });
		expect(documents[0]).toEqual({
			output: rowsOutput,
			source: {
				alias: "episode",
				type: "entities",
				schemas: ["podcast-episode"],
				where: {
					type: "and",
					values: [
						{
							operator: "eq",
							type: "comparison",
							right: { type: "literal", value: 7 },
							left: {
								type: "ref",
								sourceAlias: "episode",
								field: { type: "property", schema: "podcast-episode", path: ["episodeNumber"] },
							},
						},
						{
							type: "exists",
							source: {
								alias: "podcast",
								type: "entities",
								schemas: ["podcast"],
								via: {
									entityRef: "episode",
									direction: "incoming",
									alias: "podcastEpisodeEdge",
									schema: "podcast-to-podcast-episode",
								},
								where: {
									operator: "eq",
									type: "comparison",
									right: { type: "literal", value: "podcast-1" },
									left: {
										type: "ref",
										sourceAlias: "podcast",
										field: { type: "system", name: "id" },
									},
								},
							},
						},
					],
				},
			},
		});
	});

	it("emits documents the query language accepts", async () => {
		const { documents, host } = createHost([[], []]);

		await Effect.runPromise(
			runSandboxTestDriver(operation, { refs: [showRef, podcastRef] }, host, execution),
		);
		for (const document of documents) {
			expect(() => Schema.decodeUnknownSync(QueryDocument)(document)).not.toThrow();
		}
	});

	it("resolves only unique matches and keeps results aligned with mixed refs", async () => {
		const { documents, host } = createHost([
			["episode-1"],
			[],
			["episode-2", "episode-3"],
			["episode-4"],
		]);

		await expect(
			Effect.runPromise(
				runSandboxTestDriver(
					operation,
					{
						refs: [
							showRef,
							{ ...showRef, episodeNumber: 99 },
							{ ...podcastRef, episodeNumber: 1 },
							podcastRef,
						],
					},
					host,
					execution,
				),
			),
		).resolves.toEqual({
			results: [
				{ entityId: "episode-1" },
				{ entityId: null },
				{ entityId: null },
				{ entityId: "episode-4" },
			],
		});
		expect(documents).toHaveLength(4);
	});
});
