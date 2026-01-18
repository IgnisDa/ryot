import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./manga-updates.sandbox";

type MangaUpdatesMangaHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (httpCall: MangaUpdatesMangaHost["httpCall"]) =>
	defineSandboxTestHost(manifest, { httpCall });
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("manga.manga-updates sandbox script", () => {
	it("keeps recommendation and related-series entities", () => {
		const host = makeHost((_method, requestUrl) => {
			if (requestUrl.endsWith("/series/1")) {
				return httpSuccess({
					genres: [],
					status: null,
					series_id: 1,
					title: "Source",
					recommendations: [{ series_id: 2 }],
					related_series: [{ related_series_id: 3 }],
				});
			}
			if (requestUrl.endsWith("/series/2")) {
				return httpSuccess({ title: "Recommendation", series_id: 2 });
			}
			return httpSuccess({ title: "Related", series_id: 3 });
		});
		return Effect.runPromise(
			runSandboxTestDriver(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "media-suggestion",
							entities: [
								{ name: "Recommendation", externalId: "2", scriptSlug: "manga.manga-updates" },
								{ name: "Related", externalId: "3", scriptSlug: "manga.manga-updates" },
							],
						},
					]);
					return undefined;
				}),
			),
		);
	});
	it("extracts volumes and production status from the HTML status field", () => {
		const host = makeHost((_method, url) =>
			url.endsWith("/series/7")
				? httpSuccess({
						series_id: 7,
						year: "2004",
						title: "Source",
						latest_chapter: 120,
						bayesian_rating: 8.53,
						description: "A story",
						genres: [{ genre: "Action" }],
						categories: [{ category: "Isekai" }],
						url: "https://www.mangaupdates.com/series/source",
						status: "12 Volumes (Ongoing)<br>6 Volumes (English)",
						image: { url: { original: "https://img/cover.jpg" } },
					})
				: httpSuccess({}),
		);
		return Effect.runPromise(
			runSandboxTestDriver(details, { externalId: "7" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("Source");
					expect(result.properties).toEqual({
						volumes: 12,
						chapters: 120,
						publishYear: 2004,
						providerRating: 8.53,
						description: "A story",
						productionStatus: "Ongoing",
						genres: ["Action", "Isekai"],
						sourceUrl: "https://www.mangaupdates.com/series/source",
						images: [{ type: "remote", url: "https://img/cover.jpg" }],
					});
					return undefined;
				}),
			),
		);
	});
	it("maps search hits and skips failed suggestion lookups", () => {
		const host = makeHost(() =>
			httpSuccess({
				total_hits: 25,
				results: [
					{
						hit_title: "Hit Title",
						record: {
							year: "2019",
							series_id: 9,
							title: "Record Title",
							image: { url: { original: "https://img/9.jpg" } },
						},
					},
					{ record: { series_id: 10 } },
					{ hit_title: "No Record" },
				],
			}),
		);
		return Effect.runPromise(
			runSandboxTestDriver(search, { query: "hit", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{
							externalId: "9",
							calloutProperty: { kind: "null", value: null },
							titleProperty: { kind: "text", value: "Hit Title" },
							secondarySubtitleProperty: { kind: "null", value: null },
							primarySubtitleProperty: { kind: "number", value: 2019 },
							imageProperty: { kind: "image", value: { type: "remote", url: "https://img/9.jpg" } },
						},
					]);
					expect(result.details).toEqual({ totalItems: 25, nextPage: 2 });
					return undefined;
				}),
			),
		);
	});
});
