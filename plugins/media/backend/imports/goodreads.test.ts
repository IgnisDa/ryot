import { describe, expect, it } from "vitest";

import { adaptGoodreadsCsv } from "./goodreads";

const GOODREADS_HEADERS = "Title,ISBN13,My Rating,Date Read,Bookshelves,My Review,Read Count";

describe("adaptGoodreadsCsv", () => {
	it("maps completed history, reviews, and custom shelves to unresolved groups", () => {
		const csv = [
			GOODREADS_HEADERS,
			'Book One,9780140328721,4,2026/01/02,"read,favorites,science-fiction",Loved it,2',
		].join("\n");

		const result = adaptGoodreadsCsv(csv);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(1);
		expect(result.entityGroups[0]).toMatchObject({
			collectionMemberships: [
				{ collectionName: "Favorites" },
				{ collectionName: "Science Fiction" },
			],
			entityRef: {
				kind: "unresolved",
				identifierType: "isbn",
				sourceLabel: "Book One",
				entitySchemaSlug: "book",
				identifierValue: "9780140328721",
			},
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

	it("maps current and want-to-read shelves to lifecycle events across distinct ISBNs", () => {
		const csv = [
			GOODREADS_HEADERS,
			'Current Book,9780140328721,,,"currently-reading",,0',
			'TBR Book,9780743273565,,,"to-read",,0',
		].join("\n");

		const result = adaptGoodreadsCsv(csv);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups.map((group) => group.entityRef)).toMatchObject([
			{ kind: "unresolved", identifierValue: "9780140328721" },
			{ kind: "unresolved", identifierValue: "9780743273565" },
		]);
		expect(result.entityGroups.map((group) => group.events[0]?.eventSchemaSlug)).toEqual([
			"progress",
			"backlog",
		]);
	});

	it("collapses duplicate ISBNs into a single group before resolution", () => {
		const csv = [
			GOODREADS_HEADERS,
			"First Copy,9780140328721,,2026/01/02,read,,1",
			"Second Copy,9780140328721,,,currently-reading,,0",
		].join("\n");

		const result = adaptGoodreadsCsv(csv);

		expect(result.entityGroups).toHaveLength(1);
		expect(result.entityGroups[0]?.entityRef).toMatchObject({
			sourceLabel: "First Copy",
			identifierValue: "9780140328721",
		});
		expect(result.entityGroups[0]?.events.map((event) => event.eventSchemaSlug)).toEqual([
			"complete",
			"progress",
		]);
	});

	it("records row-level failures when the ISBN is empty", () => {
		const csv = [GOODREADS_HEADERS, "Broken Book,,4,2026/01/02,read,,1"].join("\n");

		const result = adaptGoodreadsCsv(csv);

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{ itemIndex: 0, message: "ISBN13 is empty", sourceLabel: "Broken Book" },
		]);
	});

	it("rejects invalid Goodreads ISBN values with non-digit characters", () => {
		const csv = [GOODREADS_HEADERS, "Broken Book,abc123,4,2026/01/02,read,,1"].join("\n");

		const result = adaptGoodreadsCsv(csv);

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				sourceLabel: "Broken Book",
				sourceIdentifier: "abc123",
				context: { rawIsbn: "abc123" },
				message: "Invalid ISBN format",
			},
		]);
	});

	it("rejects ISBNs that fail the checksum validation", () => {
		const csv = [GOODREADS_HEADERS, "Bad Checksum,9780140328722,4,2026/01/02,read,,1"].join("\n");

		const result = adaptGoodreadsCsv(csv);

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				sourceLabel: "Bad Checksum",
				message: "ISBN13 is invalid",
				sourceIdentifier: "9780140328722",
				context: { isbn: "9780140328722" },
			},
		]);
	});

	it("parses month-first date formats as a fallback", () => {
		const csv = [GOODREADS_HEADERS, "US Format,9780140328721,4,1/2/23,read,,1"].join("\n");

		const result = adaptGoodreadsCsv(csv);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(1);
		expect(result.entityGroups[0]?.events[0]).toMatchObject({
			eventSchemaSlug: "complete",
			properties: { completedOn: "2023-01-02T00:00:00.000Z" },
		});
	});
});
