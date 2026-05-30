import { describe, expect, it } from "bun:test";

import { adaptHardcoverCsv } from "./adapter";

const HARDCOVER_HEADERS =
	"Title,Status,Hardcover Book ID,Lists,Date Started,Date Finished,Rating,Review,Review Contains Spoilers,Review Date,Owned";

describe("adaptHardcoverCsv", () => {
	it("maps historical lifecycle events, review details, and collections", () => {
		const csv = [
			HARDCOVER_HEADERS,
			'Book One,Read,1001,"Book Club (#4), Favorites",2026-03-01,2026-03-07,4.5,Excellent,true,2026-03-08T10:30:00Z,true',
		].join("\n");

		const result = adaptHardcoverCsv(csv);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(1);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: {
				externalId: "1001",
				entitySchemaSlug: "book",
				scriptSlug: "book.hardcover",
			},
			collectionMemberships: [
				{ collectionName: "Book Club" },
				{ collectionName: "Favorites" },
				{ collectionName: "Owned" },
			],
		});
		expect(result.entityGroups[0]?.events).toEqual([
			{
				eventSchemaSlug: "complete",
				occurredAt: "2026-03-07T00:00:00.000Z",
				properties: {
					completionMode: "custom_timestamps",
					startedOn: "2026-03-01T00:00:00.000Z",
					completedOn: "2026-03-07T00:00:00.000Z",
				},
			},
			{
				eventSchemaSlug: "review",
				occurredAt: "2026-03-08T10:30:00.000Z",
				properties: { rating: 90, text: "Excellent", isSpoiler: true },
			},
		]);
	});

	it("maps backlog status and records missing hardcover identifiers", () => {
		const csv = [
			HARDCOVER_HEADERS,
			"Queued Book,Want to Read,1002,,,,,,,false",
			"Broken Book,Read,,,,,,,,false",
		].join("\n");

		const result = adaptHardcoverCsv(csv);

		expect(result.entityGroups[0]?.events).toEqual([
			{
				properties: {},
				eventSchemaSlug: "backlog",
				occurredAt: expect.any(String),
			},
		]);
		expect(result.failures).toEqual([
			{ itemIndex: 1, message: "Empty Hardcover Book ID", sourceLabel: "Broken Book" },
		]);
	});

	it("rejects non-numeric hardcover ids during transformation", () => {
		const csv = [HARDCOVER_HEADERS, "Broken Book,Read,book_3,,,,,,,,false"].join("\n");

		const result = adaptHardcoverCsv(csv);

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				sourceIdentifier: "book_3",
				sourceLabel: "Broken Book",
				message: "Hardcover Book ID must be numeric",
			},
		]);
	});
});
