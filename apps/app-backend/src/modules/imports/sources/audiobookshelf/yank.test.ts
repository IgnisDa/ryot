import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { stubHttpClientLayer, type StubHttpResponse } from "#lib/test-support/source-http";

import { syncAudiobookshelfOwnedItems } from "./adapter";

const input = { apiKey: "key", apiUrl: "http://abs.test" };

const library = (id: string, name: string) => ({ id, name });

describe("syncAudiobookshelfOwnedItems", () => {
	it.effect("returns owned audiobooks and ebooks regardless of finished state", () =>
		Effect.gen(function* () {
			// Items carry no userMediaProgress: ownership ignores listen progress,
			// unlike the import path which filters libraries to finished books.
			const routes: Record<string, StubHttpResponse> = {
				"/api/libraries": { body: { libraries: [library("lib1", "Audiobooks")] } },
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

			const result = yield* syncAudiobookshelfOwnedItems(input).pipe(
				Effect.provide(stubHttpClientLayer((request) => routes[request.path] ?? { body: {} })),
			);

			expect(result).toEqual([
				{
					provider: "audiobookshelf",
					entityRef: {
						kind: "resolved",
						externalId: "B08G9PRS1K",
						sourceLabel: "Project Hail Mary",
						scriptSlug: "audiobook.audible",
						entitySchemaSlug: "audiobook",
					},
				},
				{
					provider: "audiobookshelf",
					entityRef: {
						kind: "unresolved",
						sourceLabel: "Dune",
						identifierType: "isbn",
						entitySchemaSlug: "book",
						identifierValue: "9780441013593",
					},
				},
			]);
		}),
	);

	it.effect("omits items without a usable identifier", () =>
		Effect.gen(function* () {
			const routes: Record<string, StubHttpResponse> = {
				"/api/libraries": { body: { libraries: [library("lib1", "Books")] } },
				"/api/libraries/lib1/items": {
					body: {
						results: [
							{
								id: "a1",
								media: { ebookFormat: null, metadata: { title: "Has Asin", asin: "B01" } },
							},
							{ id: "x1", media: { ebookFormat: null, metadata: { title: "No Ids" } } },
						],
					},
				},
			};

			const result = yield* syncAudiobookshelfOwnedItems(input).pipe(
				Effect.provide(stubHttpClientLayer((request) => routes[request.path] ?? { body: {} })),
			);

			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({ entityRef: { externalId: "B01" } });
		}),
	);

	it.effect("skips a library whose item fetch fails and keeps the rest", () =>
		Effect.gen(function* () {
			const routes: Record<string, StubHttpResponse> = {
				"/api/libraries": { body: { libraries: [library("lib1", "A"), library("lib2", "B")] } },
				"/api/libraries/lib1/items": {
					body: {
						results: [
							{ id: "a1", media: { ebookFormat: null, metadata: { title: "Owned", asin: "B01" } } },
						],
					},
				},
				"/api/libraries/lib2/items": { status: 500 },
			};

			const result = yield* syncAudiobookshelfOwnedItems(input).pipe(
				Effect.provide(stubHttpClientLayer((request) => routes[request.path] ?? { body: {} })),
			);

			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				provider: "audiobookshelf",
				entityRef: { externalId: "B01", entitySchemaSlug: "audiobook" },
			});
		}),
	);
});
