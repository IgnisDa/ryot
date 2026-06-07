import { describe, expect, it } from "bun:test";

import { resolveMockResponse } from "~/modules/imports/sources/shared/test-utils";

import { fetchAudiobookshelfProgress, syncAudiobookshelfOwnedItems } from "./audiobookshelf";

const MOCK_INPUT = { token: "secret", baseUrl: "https://abs.local" };

const createDeps = (overrides: Record<string, unknown> = {}) => ({
	mapWithConcurrency: async <TItem, TResult>(
		items: TItem[],
		_concurrency: number,
		mapper: (item: TItem, index: number) => Promise<TResult>,
	) => Promise.all(items.map((item, index) => mapper(item, index))),
	requestJson: <T>(input: { path: string; query?: Record<string, unknown> }) => {
		const { path, query } = input;

		if (path === "me/items-in-progress") {
			return resolveMockResponse<T>({
				episodeItems: [],
				libraryItems: [
					{
						id: "audio_1",
						userMediaProgress: { progress: 0.4, isFinished: false },
						media: { metadata: { title: "Audiobook One", asin: "B001" } },
					},
					{
						id: "book_1",
						userMediaProgress: { ebookProgress: 0.6, isFinished: false },
						media: {
							ebookFormat: "epub",
							metadata: { title: "Epub Book", isbn: "9780306406157" },
						},
					},
					{
						id: "no_id",
						media: { metadata: { title: "No ID Item" } },
						userMediaProgress: { progress: 0.3, isFinished: false },
					},
				],
				...overrides,
			});
		}

		throw new Error(`Unhandled path: ${path} ${JSON.stringify(query)}`);
	},
});

describe("fetchAudiobookshelfProgress", () => {
	it("maps in-progress audiobooks and ebooks", async () => {
		const result = await fetchAudiobookshelfProgress(MOCK_INPUT, createDeps());

		expect(result.entityGroups).toHaveLength(2);

		expect(result.entityGroups[0]).toMatchObject({
			entityRef: {
				kind: "resolved",
				externalId: "B001",
				entitySchemaSlug: "audiobook",
				scriptSlug: "audiobook.audible",
			},
			events: [
				{
					eventSchemaSlug: "progress",
					properties: { progressPercent: 40, consumedOn: "audiobookshelf" },
				},
			],
		});

		expect(result.entityGroups[1]).toMatchObject({
			entityRef: {
				kind: "unresolved",
				identifierType: "isbn",
				entitySchemaSlug: "book",
				identifierValue: "9780306406157",
			},
			events: [
				{
					eventSchemaSlug: "progress",
					properties: { progressPercent: 60, consumedOn: "audiobookshelf" },
				},
			],
		});

		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({
			sourceIdentifier: "no_id",
			stage: "input_transformation",
		});
	});

	it("skips finished items", async () => {
		const result = await fetchAudiobookshelfProgress(
			MOCK_INPUT,
			createDeps({
				libraryItems: [
					{
						id: "done_1",
						media: { metadata: { title: "Done", asin: "B999" } },
						userMediaProgress: { progress: 1.0, isFinished: true },
					},
				],
			}),
		);

		expect(result.entityGroups).toHaveLength(0);
		expect(result.failures).toHaveLength(0);
	});

	it("returns empty result for empty response", async () => {
		const result = await fetchAudiobookshelfProgress(
			MOCK_INPUT,
			createDeps({ libraryItems: [], episodeItems: [] }),
		);

		expect(result.entityGroups).toHaveLength(0);
		expect(result.failures).toHaveLength(0);
	});
});

describe("syncAudiobookshelfOwnedItems", () => {
	const ownedDeps = {
		mapWithConcurrency: async <TItem, TResult>(
			items: TItem[],
			_concurrency: number,
			mapper: (item: TItem, index: number) => Promise<TResult>,
		) => Promise.all(items.map((item, index) => mapper(item, index))),
		requestJson: <T>(input: { path: string }) => {
			if (input.path === "libraries") {
				return resolveMockResponse<T>({
					libraries: [{ id: "lib_1", mediaType: "book", name: "Books" }],
				});
			}
			if (input.path === "libraries/lib_1/items") {
				return resolveMockResponse<T>({
					results: [
						{ id: "a1", media: { metadata: { title: "Audio", asin: "ASIN1" } } },
						{
							id: "b1",
							media: { ebookFormat: "epub", metadata: { title: "Book", isbn: "9780306406157" } },
						},
					],
				});
			}
			throw new Error(`Unhandled: ${input.path}`);
		},
	};

	it("returns owned entity refs for all library items", async () => {
		const result = await syncAudiobookshelfOwnedItems(MOCK_INPUT, ownedDeps);

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			provider: "audiobookshelf",
			entityRef: { kind: "resolved", externalId: "ASIN1", entitySchemaSlug: "audiobook" },
		});
		expect(result[1]).toMatchObject({
			provider: "audiobookshelf",
			entityRef: { kind: "unresolved", identifierValue: "9780306406157", entitySchemaSlug: "book" },
		});
	});
});
