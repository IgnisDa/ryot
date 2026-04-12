import { describe, expect, it } from "bun:test";

import { resolveMockResponse } from "../shared/test-utils";
import { adaptAudiobookshelfData } from "./adapter";

const createDeps = () => ({
	mapWithConcurrency: async <TItem, TResult>(
		items: TItem[],
		_concurrency: number,
		mapper: (item: TItem, index: number) => Promise<TResult>,
	) => Promise.all(items.map((item, index) => mapper(item, index))),
	requestJson: <T>(input: { path: string; query?: Record<string, unknown> }) => {
		if (input.path === "libraries") {
			return resolveMockResponse<T>({
				libraries: [
					{ id: "lib_books", mediaType: "book", name: "Completed Books" },
					{ id: "lib_podcasts", mediaType: "podcast", name: "Podcasts" },
				],
			});
		}

		if (input.path === "libraries/lib_books/items") {
			expect(input.query?.filter).toBe("progress.ZmluaXNoZWQ=");
			return resolveMockResponse<T>({
				results: [
					{
						id: "book_1",
						media: { ebookFormat: "epub", metadata: { isbn: "9780306406157", title: "Book One" } },
					},
					{ id: "audio_1", media: { metadata: { asin: "ASIN123", title: "Audio One" } } },
				],
			});
		}

		if (input.path === "libraries/lib_podcasts/items") {
			return resolveMockResponse<T>({
				results: [
					{ id: "pod_1", media: { metadata: { itunesId: "IT1", title: "Podcast One" } } },
					{ id: "pod_2", media: { metadata: { itunesId: "IT2", title: "Podcast Two" } } },
				],
			});
		}

		if (input.path === "items/pod_1" && input.query?.episode === undefined) {
			return resolveMockResponse<T>({
				id: "pod_1",
				media: {
					metadata: { itunesId: "IT1", title: "Podcast One" },
					episodes: [
						{ episodeNumber: 7, id: "ep_1", title: "Episode 7" },
						{ id: "ep_2", title: "Episode 8" },
					],
				},
			});
		}

		if (input.path === "items/pod_1" && input.query?.episode === "ep_1") {
			return resolveMockResponse<T>({ id: "pod_1", userMediaProgress: { isFinished: true } });
		}

		if (input.path === "items/pod_1" && input.query?.episode === "ep_2") {
			return resolveMockResponse<T>({ id: "pod_1", userMediaProgress: { isFinished: false } });
		}

		if (input.path === "items/pod_2" && input.query?.episode === undefined) {
			return resolveMockResponse<T>({
				id: "pod_2",
				media: {
					episodes: [{ id: "ep_bad", title: "Mystery Episode" }],
					metadata: { itunesId: "IT2", title: "Podcast Two" },
				},
			});
		}

		if (input.path === "items/pod_2" && input.query?.episode === "ep_bad") {
			return resolveMockResponse<T>({ id: "pod_2", userMediaProgress: { isFinished: true } });
		}

		throw new Error(`Unhandled path ${input.path}`);
	},
});

describe("adaptAudiobookshelfData", () => {
	it("maps completed books, audiobooks, and podcast episode coverage", async () => {
		const result = await adaptAudiobookshelfData(
			{ apiKey: "secret", apiUrl: "https://audiobookshelf.local" },
			createDeps(),
		);

		expect(result.entityGroups).toHaveLength(3);
		expect(result.entityGroups[0]).toMatchObject({
			collectionMemberships: [{ collectionName: "Completed Books" }],
			entityRef: {
				kind: "unresolved",
				identifierType: "isbn",
				sourceLabel: "Book One",
				entitySchemaSlug: "book",
				identifierValue: "9780306406157",
			},
		});
		expect(result.entityGroups[0]?.events[0]?.eventSchemaSlug).toBe("complete");

		expect(result.entityGroups[1]).toMatchObject({
			collectionMemberships: [{ collectionName: "Completed Books" }],
			entityRef: {
				kind: "resolved",
				externalId: "ASIN123",
				sourceLabel: "Audio One",
				entitySchemaSlug: "audiobook",
				scriptSlug: "audiobook.audible",
			},
		});
		expect(result.entityGroups[1]?.events[0]?.eventSchemaSlug).toBe("complete");

		expect(result.entityGroups[2]).toMatchObject({
			collectionMemberships: [{ collectionName: "Podcasts" }],
			entityRef: {
				kind: "resolved",
				externalId: "IT1",
				sourceLabel: "Podcast One",
				entitySchemaSlug: "podcast",
				scriptSlug: "podcast.itunes",
			},
			events: [
				{ eventSchemaSlug: "progress", properties: { podcastEpisode: 7, progressPercent: 100 } },
			],
		});

		expect(result.failures).toEqual([
			{
				itemIndex: 3,
				sourceIdentifier: "pod_2",
				sourceLabel: "Podcast Two",
				stage: "input_transformation",
				message: "Audiobookshelf podcast has no finished episodes with importable episode numbers",
			},
		]);
	});
});
