import { describe, expect, it } from "bun:test";

import { adaptStorygraphCsv } from "./adapter";

const STORYGRAPH_HEADERS =
	"Title,ISBN/UID,Read Status,Read Count,Star Rating,Review,Last Date Read,Tags";

describe("adaptStorygraphCsv", () => {
	it("maps read count, current status, reviews, and tags", async () => {
		const csv = [
			STORYGRAPH_HEADERS,
			'Book One,9780140328721,currently-reading,2,4.5,Great reread,2026/02/03,"Book Club, Favorites"',
		].join("\n");

		const result = await adaptStorygraphCsv(csv, {
			resolveBookEntityRef: () =>
				Promise.resolve({
					externalId: "OL999W",
					sourceLabel: "Book One",
					entitySchemaSlug: "book",
					scriptSlug: "book.openlibrary",
				}),
		});

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(1);
		expect(result.entityGroups[0]?.collectionMemberships).toEqual([
			{ collectionName: "Book Club" },
			{ collectionName: "Favorites" },
		]);
		expect(result.entityGroups[0]?.events).toEqual([
			{
				eventSchemaSlug: "complete",
				occurredAt: "2026-02-03T00:00:00.000Z",
				properties: {
					completionMode: "custom_timestamps",
					completedOn: "2026-02-03T00:00:00.000Z",
				},
			},
			{
				eventSchemaSlug: "complete",
				occurredAt: "2026-02-03T00:00:00.000Z",
				properties: {
					completionMode: "custom_timestamps",
					completedOn: "2026-02-03T00:00:00.000Z",
				},
			},
			{
				eventSchemaSlug: "progress",
				properties: { progressPercent: 1 },
				occurredAt: "2026-02-03T00:00:00.000Z",
			},
			{
				eventSchemaSlug: "review",
				occurredAt: "2026-02-03T00:00:00.000Z",
				properties: { rating: 90, text: "Great reread" },
			},
		]);
	});

	it("maps on-hold status and records missing ISBN failures", async () => {
		const csv = [
			STORYGRAPH_HEADERS,
			"Paused Book,9780140328721,on-hold,0,,,2026/02/03,",
			"Missing ISBN,,to-read,0,,,,",
		].join("\n");

		const result = await adaptStorygraphCsv(csv, {
			resolveBookEntityRef: ({ sourceLabel }) =>
				Promise.resolve({
					sourceLabel,
					externalId: "OL777W",
					entitySchemaSlug: "book",
					scriptSlug: "book.openlibrary",
				}),
		});

		expect(result.entityGroups[0]?.events).toEqual([
			{
				eventSchemaSlug: "on_hold",
				properties: { progressPercent: 1 },
				occurredAt: "2026-02-03T00:00:00.000Z",
			},
		]);
		expect(result.failures).toEqual([
			{ itemIndex: 1, message: "No ISBN found", sourceLabel: "Missing ISBN" },
		]);
	});

	it("rejects non-isbn StoryGraph identifiers before provider lookup", async () => {
		const csv = [STORYGRAPH_HEADERS, "Bad UID,abc123,to-read,0,,,,"].join("\n");

		const result = await adaptStorygraphCsv(csv, {
			resolveBookEntityRef: () => {
				throw new Error("should not be called");
			},
		});

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				sourceLabel: "Bad UID",
				sourceIdentifier: "123",
				context: { isbn: "123" },
				message: "ISBN/UID is not a valid ISBN",
			},
		]);
	});
});
