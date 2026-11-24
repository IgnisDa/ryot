import { describe, expect, it } from "bun:test";

import { adaptMediaHistoryBatch } from "./media-history";

const show = {
	externalId: "1399",
	title: "Synthetic Show",
	entitySchemaSlug: "show",
	providerSlug: "show.tmdb",
	events: [
		{
			eventSchemaSlug: "complete",
			occurredAt: "2024-01-02T00:00:00.000Z",
			episode: { type: "show", seasonNumber: 2, episodeNumber: 1 },
			properties: { sourceRun: "seen:1", consumedOn: ["Plex"], calendarDate: "2024-01-02" },
		},
		{
			eventSchemaSlug: "review",
			occurredAt: "2024-01-03T10:00:00.000Z",
			episode: { seasonNumber: 2, type: "show-season" },
			properties: { rating: 80, text: "Synthetic review." },
		},
		{
			eventSchemaSlug: "progress",
			properties: { dateUnknown: true },
			occurredAt: "2024-01-04T10:00:00.000Z",
		},
	],
};

describe("adaptMediaHistoryBatch", () => {
	it("keeps provider identity, episode references and event properties", () => {
		expect(adaptMediaHistoryBatch([show])).toEqual({
			failures: [],
			totalItems: 1,
			nextEventOffset: 0,
			entityGroups: [
				{
					itemIndex: 0,
					collectionMemberships: [],
					entityRef: {
						kind: "resolved",
						externalId: "1399",
						entitySchemaSlug: "show",
						providerSlug: "show.tmdb",
						sourceLabel: "Synthetic Show",
					},
					events: [
						{
							eventSchemaSlug: "complete",
							occurredAt: "2024-01-02T00:00:00.000Z",
							unresolvedEpisode: { type: "show", seasonNumber: 2, episodeNumber: 1 },
							properties: { sourceRun: "seen:1", consumedOn: ["Plex"], calendarDate: "2024-01-02" },
						},
						{
							eventSchemaSlug: "review",
							occurredAt: "2024-01-03T10:00:00.000Z",
							properties: { rating: 80, text: "Synthetic review." },
							unresolvedEpisode: { seasonNumber: 2, type: "show-season" },
						},
						{
							eventSchemaSlug: "progress",
							properties: { dateUnknown: true },
							occurredAt: "2024-01-04T10:00:00.000Z",
						},
					],
				},
			],
		});
	});

	it("pages a title's events and resumes from the returned offset", () => {
		const first = adaptMediaHistoryBatch([show], 0, 2);
		expect(first.nextEventOffset).toBe(2);
		expect(first.entityGroups[0]?.events.map(({ eventSchemaSlug }) => eventSchemaSlug)).toEqual([
			"complete",
			"review",
		]);
		const second = adaptMediaHistoryBatch([show], first.nextEventOffset, 2);
		expect(second.nextEventOffset).toBe(0);
		expect(second.entityGroups[0]?.events.map(({ eventSchemaSlug }) => eventSchemaSlug)).toEqual([
			"progress",
		]);
	});

	it.each([
		["a missing provider", { ...show, providerSlug: undefined }],
		[
			"an unreadable timestamp",
			{ ...show, events: [{ ...show.events[2], occurredAt: "yesterday" }] },
		],
		[
			"an unknown episode reference",
			{ ...show, events: [{ ...show.events[0], episode: { type: "season", seasonNumber: 1 } }] },
		],
	])("reports an item with %s as malformed", (_, item) => {
		expect(adaptMediaHistoryBatch([item])).toEqual({
			totalItems: 1,
			entityGroups: [],
			nextEventOffset: 0,
			failures: [{ itemIndex: 0, message: "Media history item is malformed" }],
		});
	});
});
