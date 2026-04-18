import { describe, expect, it } from "bun:test";

import { resolveMockResponse } from "~/modules/imports/sources/shared/test-utils";

import { fetchKomgaProgress, syncKomgaOwnedItems } from "./komga";

const MOCK_INPUT = { apiKey: "key123", baseUrl: "https://komga.local" };

const makeBook = (
	id: string,
	title: string,
	anilistId: string | null,
	page: number,
	pagesCount: number,
	completed = false,
) => ({
	id,
	media: { pagesCount },
	readProgress: { page, completed },
	metadata: {
		title,
		links: anilistId ? [{ label: "Anilist", url: `https://anilist.co/manga/${anilistId}` }] : [],
	},
});

const createDeps = (books: unknown[]) => ({
	mapWithConcurrency: async <TItem, TResult>(
		items: TItem[],
		_concurrency: number,
		mapper: (item: TItem, index: number) => Promise<TResult>,
	) => Promise.all(items.map((item, index) => mapper(item, index))),
	requestJson: <T>() =>
		resolveMockResponse<T>({ content: books, totalPages: 1, totalElements: books.length }),
});

describe("fetchKomgaProgress", () => {
	it("maps in-progress books to manga entity groups", async () => {
		const books = [
			makeBook("b1", "Manga A", "1001", 50, 200),
			makeBook("b2", "Manga B", "1002", 100, 300),
		];

		const result = await fetchKomgaProgress(MOCK_INPUT, createDeps(books));

		expect(result.entityGroups).toHaveLength(2);
		expect(result.entityGroups[0]).toMatchObject({
			events: [{ eventSchemaSlug: "progress", properties: { consumedOn: "komga" } }],
			entityRef: {
				kind: "unresolved",
				identifierValue: "1001",
				entitySchemaSlug: "manga",
				identifierType: "anilist_id",
			},
		});
		expect(result.failures).toHaveLength(0);
	});

	it("records failure for books with no resolvable identifier", async () => {
		const books = [makeBook("b1", "No Links", null, 10, 100)];

		const result = await fetchKomgaProgress(MOCK_INPUT, createDeps(books));

		expect(result.entityGroups).toHaveLength(0);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({
			sourceIdentifier: "b1",
			stage: "input_transformation",
		});
	});

	it("skips completed books", async () => {
		const books = [makeBook("b1", "Done", "123", 200, 200, true)];

		const result = await fetchKomgaProgress(MOCK_INPUT, createDeps(books));

		expect(result.entityGroups).toHaveLength(0);
		expect(result.failures).toHaveLength(0);
	});

	it("returns empty result for empty library", async () => {
		const result = await fetchKomgaProgress(MOCK_INPUT, createDeps([]));

		expect(result.entityGroups).toHaveLength(0);
		expect(result.failures).toHaveLength(0);
	});
});

describe("syncKomgaOwnedItems", () => {
	it("returns owned refs for all books with identifiers", async () => {
		const books = [
			makeBook("b1", "Manga A", "1001", 0, 200),
			makeBook("b2", "No Links", null, 0, 100),
		];

		const result = await syncKomgaOwnedItems(MOCK_INPUT, createDeps(books));

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			provider: "komga",
			entityRef: { kind: "unresolved", identifierValue: "1001", entitySchemaSlug: "manga" },
		});
	});
});
