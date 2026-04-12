import { describe, expect, it } from "bun:test";

import { adaptNetflixExports } from "./adapter";

const viewingHeaders = [
	"Title",
	"Bookmark",
	"Duration",
	"Start Time",
	"Attributes",
	"Profile Name",
	"Latest Bookmark",
	"Supplemental Video Type",
].join(",");

describe("adaptNetflixExports", () => {
	it("maps viewing history, ratings, and my list rows while respecting profile filters", async () => {
		const lookupCalls: Array<{ title: string; preferredEntitySchemaSlug?: string }> = [];
		const result = await adaptNetflixExports(
			{
				profileName: "Kids",
				myListCsv: ["Title Name,Profile Name", "The Queen's Gambit,Kids"].join("\n"),
				ratingsCsv: [
					"Title Name,Profile Name,Event Utc Ts,Star Value,Thumbs Value",
					"Stranger Things,Kids,2026-01-05 12:00:00,4,",
					"The Irishman,Other,2026-01-06 12:00:00,5,",
				].join("\n"),
				viewingActivityCsv: [
					viewingHeaders,
					"Stranger Things: Stranger Things 4: Chapter Nine: The Piggyback,00:50:00,01:00:00,2026-01-03 10:00:00,,Kids,,",
					"The Irishman,03:29:00,03:29:00,2026-01-04 20:00:00,,Kids,,",
					"Ozark,00:40:00,01:00:00,2026-01-07 10:00:00,,Other,,",
				].join("\n"),
			},
			{
				now: () => "2026-02-10T00:00:00.000Z",
				lookupTitle: ({ title, preferredEntitySchemaSlug }) => {
					lookupCalls.push({ title, preferredEntitySchemaSlug });
					if (title.startsWith("Stranger Things")) {
						return Promise.resolve({
							matchedTitle: "Stranger Things",
							entityRef: {
								kind: "resolved",
								externalId: "66732",
								scriptSlug: "show.tmdb",
								entitySchemaSlug: "show",
								sourceLabel: "Stranger Things",
							},
						});
					}
					if (title === "The Irishman") {
						return Promise.resolve({
							matchedTitle: "The Irishman",
							entityRef: {
								kind: "resolved",
								externalId: "398978",
								scriptSlug: "movie.tmdb",
								entitySchemaSlug: "movie",
								sourceLabel: "The Irishman",
							},
						});
					}
					if (title === "The Queen's Gambit") {
						return Promise.resolve({
							matchedTitle: "The Queen's Gambit",
							entityRef: {
								kind: "resolved",
								externalId: "87739",
								scriptSlug: "show.tmdb",
								entitySchemaSlug: "show",
								sourceLabel: "The Queen's Gambit",
							},
						});
					}
					return Promise.resolve({ error: "Metadata not found" });
				},
			},
		);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toEqual([
			{
				itemIndex: 0,
				collectionMemberships: [],
				entityRef: {
					kind: "resolved",
					externalId: "66732",
					scriptSlug: "show.tmdb",
					entitySchemaSlug: "show",
					sourceLabel: "Stranger Things",
				},
				events: [
					{
						eventSchemaSlug: "progress",
						occurredAt: "2026-01-03T10:00:00.000Z",
						properties: { progressPercent: 100, showSeason: 4, showEpisode: 9 },
					},
					{
						eventSchemaSlug: "review",
						properties: { rating: 80 },
						occurredAt: "2026-01-05T12:00:00.000Z",
					},
				],
			},
			{
				itemIndex: 1,
				collectionMemberships: [],
				entityRef: {
					kind: "resolved",
					externalId: "398978",
					scriptSlug: "movie.tmdb",
					entitySchemaSlug: "movie",
					sourceLabel: "The Irishman",
				},
				events: [
					{
						eventSchemaSlug: "complete",
						occurredAt: "2026-01-04T20:00:00.000Z",
						properties: {
							completionMode: "custom_timestamps",
							completedOn: "2026-01-04T20:00:00.000Z",
						},
					},
				],
			},
			{
				itemIndex: 5,
				collectionMemberships: [],
				entityRef: {
					kind: "resolved",
					externalId: "87739",
					scriptSlug: "show.tmdb",
					entitySchemaSlug: "show",
					sourceLabel: "The Queen's Gambit",
				},
				events: [
					{
						properties: {},
						eventSchemaSlug: "backlog",
						occurredAt: "2026-02-10T00:00:00.000Z",
					},
				],
			},
		]);
		expect(lookupCalls).toEqual([
			{
				preferredEntitySchemaSlug: "show",
				title: "Stranger Things: Stranger Things 4: Chapter Nine: The Piggyback",
			},
			{ title: "The Irishman", preferredEntitySchemaSlug: undefined },
			{ title: "Stranger Things", preferredEntitySchemaSlug: "show" },
			{ title: "The Queen's Gambit", preferredEntitySchemaSlug: undefined },
		]);
	});

	it("records lookup failures and missing episode coverage as item failures", async () => {
		const result = await adaptNetflixExports(
			{
				myListCsv: ["Title Name,Profile Name", "Unknown Title,Main"].join("\n"),
				ratingsCsv: ["Title Name,Profile Name,Event Utc Ts,Star Value,Thumbs Value"].join("\n"),
				viewingActivityCsv: [
					viewingHeaders,
					"The Gentlemen: Season 1: The Gospel According to Bobby Glass,00:50:00,01:00:00,2026-01-03 10:00:00,,Main,,",
				].join("\n"),
			},
			{
				now: () => "2026-02-10T00:00:00.000Z",
				lookupTitle: ({ title }) => {
					if (title.startsWith("The Gentlemen")) {
						return Promise.resolve({
							matchedTitle: "The Gentlemen",
							entityRef: {
								kind: "resolved",
								externalId: "123",
								scriptSlug: "show.tmdb",
								entitySchemaSlug: "show",
								sourceLabel: "The Gentlemen",
							},
						});
					}
					return Promise.resolve({ error: "Metadata not found" });
				},
			},
		);

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				stage: "provider_resolution",
				sourceLabel: "The Gentlemen: Season 1: The Gospel According to Bobby Glass",
				sourceIdentifier: "The Gentlemen: Season 1: The Gospel According to Bobby Glass",
				message: "Viewing activity matched a show but no season or episode could be extracted",
			},
			{
				itemIndex: 1,
				stage: "provider_resolution",
				sourceLabel: "Unknown Title",
				message: "Metadata not found",
				sourceIdentifier: "Unknown Title",
			},
		]);
	});
});
