import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { stubHttpClientLayer, type StubHttpResponse } from "#lib/test-support/source-http";

import { adaptAudiobookshelfData } from "./adapter";

const input = { apiKey: "key", apiUrl: "http://abs.test" };

describe("adaptAudiobookshelfData", () => {
	it.effect("maps Audible audiobooks and ISBN ebooks into library collections", () =>
		Effect.gen(function* () {
			const routes: Record<string, StubHttpResponse> = {
				"/api/libraries": {
					body: { libraries: [{ id: "lib1", name: "Audiobooks", mediaType: "book" }] },
				},
				"/api/libraries/lib1/items": {
					body: {
						results: [
							{
								id: "a1",
								media: {
									ebookFormat: null,
									metadata: { title: "Project Hail Mary", asin: "B08G9PRS1K" },
								},
							},
							{
								id: "b1",
								media: { ebookFormat: "epub", metadata: { title: "Dune", isbn: "9780441013593" } },
							},
						],
					},
				},
			};

			const result = yield* adaptAudiobookshelfData(input).pipe(
				Effect.provide(stubHttpClientLayer((request) => routes[request.path] ?? { body: {} })),
			);

			expect(result.failures).toEqual([]);
			expect(result.entityGroups).toHaveLength(2);
			expect(result.entityGroups[0]).toMatchObject({
				events: [{ eventSchemaSlug: "complete" }],
				collectionMemberships: [{ collectionName: "Audiobooks" }],
				entityRef: {
					kind: "resolved",
					externalId: "B08G9PRS1K",
					scriptSlug: "audiobook.audible",
					entitySchemaSlug: "audiobook",
				},
			});
			expect(result.entityGroups[1]).toMatchObject({
				collectionMemberships: [{ collectionName: "Audiobooks" }],
				entityRef: {
					kind: "unresolved",
					identifierType: "isbn",
					entitySchemaSlug: "book",
					identifierValue: "9780441013593",
				},
			});
		}),
	);

	it.effect("records a failure for an item missing media metadata", () =>
		Effect.gen(function* () {
			const routes: Record<string, StubHttpResponse> = {
				"/api/libraries": {
					body: { libraries: [{ id: "lib1", name: "Books", mediaType: "book" }] },
				},
				"/api/libraries/lib1/items": { body: { results: [{ id: "x1", name: "Broken" }] } },
			};

			const result = yield* adaptAudiobookshelfData(input).pipe(
				Effect.provide(stubHttpClientLayer((request) => routes[request.path] ?? { body: {} })),
			);

			expect(result.entityGroups).toEqual([]);
			expect(result.failures).toHaveLength(1);
			expect(result.failures[0]).toMatchObject({
				itemIndex: 0,
				sourceIdentifier: "x1",
				stage: "input_transformation",
				message: "Audiobookshelf item is missing media metadata",
			});
		}),
	);
});
