import { describe, expect, it } from "bun:test";

import { adaptGoodreadsCsv } from "./adapter";

const GOODREADS_HEADERS = "Title,ISBN13,My Rating,Date Read,Bookshelves,My Review,Read Count";

describe("adaptGoodreadsCsv", () => {
	it("maps completed history, reviews, and custom shelves to normalized groups", async () => {
		const csv = [
			GOODREADS_HEADERS,
			'Book One,9780140328721,4,2026/01/02,"read,favorites,science-fiction",Loved it,2',
		].join("\n");

		const result = await adaptGoodreadsCsv(csv, {
			resolveBookEntityRef: () =>
				Promise.resolve({
					externalId: "OL123W",
					sourceLabel: "Book One",
					entitySchemaSlug: "book",
					scriptSlug: "book.openlibrary",
				}),
		});

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(1);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: {
				externalId: "OL123W",
				entitySchemaSlug: "book",
				scriptSlug: "book.openlibrary",
			},
			collectionMemberships: [
				{ collectionName: "Favorites" },
				{ collectionName: "Science Fiction" },
			],
		});
		expect(result.entityGroups[0]?.events).toEqual([
			{
				eventSchemaSlug: "complete",
				occurredAt: "2026-01-02T00:00:00.000Z",
				properties: {
					completionMode: "custom_timestamps",
					completedOn: "2026-01-02T00:00:00.000Z",
				},
			},
			{
				eventSchemaSlug: "complete",
				occurredAt: "2026-01-02T00:00:00.000Z",
				properties: {
					completionMode: "custom_timestamps",
					completedOn: "2026-01-02T00:00:00.000Z",
				},
			},
			{
				eventSchemaSlug: "review",
				occurredAt: "2026-01-02T00:00:00.000Z",
				properties: { rating: 80, text: "Loved it" },
			},
		]);
	});

	it("maps current and want-to-read shelves to lifecycle events", async () => {
		const csv = [
			GOODREADS_HEADERS,
			'Current Book,9780140328721,,,"currently-reading",,0',
			'TBR Book,9780140328721,,,"to-read",,0',
		].join("\n");

		let callCount = 0;
		const result = await adaptGoodreadsCsv(csv, {
			resolveBookEntityRef: ({ sourceLabel }) => {
				callCount += 1;
				return Promise.resolve({
					sourceLabel,
					entitySchemaSlug: "book",
					externalId: `OL${callCount}W`,
					scriptSlug: "book.openlibrary",
				});
			},
		});

		expect(result.failures).toEqual([]);
		expect(result.entityGroups.map((group) => group.events[0]?.eventSchemaSlug)).toEqual([
			"progress",
			"backlog",
		]);
	});

	it("records row-level failures when the ISBN cannot be resolved", async () => {
		const csv = [GOODREADS_HEADERS, "Broken Book,,4,2026/01/02,read,,1"].join("\n");

		const result = await adaptGoodreadsCsv(csv, {
			resolveBookEntityRef: () => Promise.resolve(null),
		});

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{ itemIndex: 0, message: "ISBN13 is empty", sourceLabel: "Broken Book" },
		]);
	});

	it("rejects invalid Goodreads ISBN values before provider lookup", async () => {
		const csv = [GOODREADS_HEADERS, "Broken Book,abc123,4,2026/01/02,read,,1"].join("\n");

		const result = await adaptGoodreadsCsv(csv, {
			resolveBookEntityRef: () => {
				throw new Error("should not be called");
			},
		});

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				sourceIdentifier: "123",
				context: { isbn: "123" },
				sourceLabel: "Broken Book",
				message: "ISBN13 is invalid",
			},
		]);
	});
});
