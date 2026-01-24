import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { manifest } from "./audible";
import details, { manifest as detailsManifest } from "./audible-details.sandbox";
import search, { manifest as searchManifest } from "./audible-search.sandbox";

type AudibleAudiobookHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (httpCall: AudibleAudiobookHost["httpCall"]) =>
	defineSandboxTestHost(manifest, { httpCall });
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("audiobook.audible sandbox script", () => {
	it("declares one script per operation", () => {
		expect([
			[searchManifest.slug, search.operation],
			[detailsManifest.slug, details.operation],
		]).toEqual([
			["audiobook.audible.search", "search"],
			["audiobook.audible.details", "details"],
		]);
	});
	it("deduplicates similarity buckets into related entities", () => {
		const host = makeHost((_method, requestUrl) => {
			expect(new URL(requestUrl).host).toBe("api.audible.com");
			if (requestUrl.includes("/source-book?")) {
				return httpSuccess({
					product: {
						series: [],
						authors: [],
						narrators: [],
						title: "Source",
						product_images: {},
						category_ladders: [],
						is_adult_product: false,
						runtime_length_min: 100,
						release_date: "2024-01-01",
						rating: { num_reviews: 0, overall_distribution: {} },
					},
				});
			}
			if (requestUrl.includes("similarity_type=InTheSameSeries")) {
				return httpSuccess({ similar_products: [{ asin: "book-2", title: "Series Pick" }] });
			}
			if (requestUrl.includes("similarity_type=RawSimilarities")) {
				return httpSuccess({
					similar_products: [
						{ asin: "book-2", title: "Series Pick" },
						{ asin: "book-3", title: "Similar Pick" },
					],
				});
			}
			return httpSuccess({ similar_products: [] });
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "source-book" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "incoming",
							synchronization: "authoritative",
							entities: [],
							relationshipSchemaSlug: "person-to-audiobook",
						},
						{
							entities: [],
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "audiobook-group-to-audiobook",
						},
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "media-suggestion",
							entities: [
								{ name: "Series Pick", externalId: "book-2", providerSlug: "audiobook.audible" },
								{ name: "Similar Pick", externalId: "book-3", providerSlug: "audiobook.audible" },
							],
						},
					]);
					return undefined;
				}),
			),
		);
	});
	it("merges author and narrator roles, splits genres and title-cases them", () => {
		const host = makeHost((_method, url) => {
			if (url.includes("/mixed-book?")) {
				return httpSuccess({
					product: {
						title: "Mixed",
						is_adult_product: true,
						runtime_length_min: 610.9,
						release_date: "2020-05-02T00:00:00Z",
						series: [{ asin: "series-1", title: "The Saga" }],
						authors: [{ asin: "person-1", name: "Jane Doe" }, { name: "No Asin" }],
						narrators: [{ asin: "person-1", name: "Jane Doe" }],
						product_images: { "2400": "https://img/big.jpg", "500": "https://img/small.jpg" },
						category_ladders: [{ ladder: [{ name: "science fiction & FANTASY" }] }],
						rating: { num_reviews: 4, overall_distribution: { display_average_rating: "4.5" } },
						publisher_summary: "<p>Line one<br>Line two</p>",
					},
				});
			}
			return httpSuccess({ similar_products: [] });
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "mixed-book" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("Mixed");
					expect(result.relatedEntityGroups?.[0]).toEqual({
						direction: "incoming",
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-audiobook",
						entities: [
							{
								name: "Jane Doe",
								externalId: "person-1",
								providerSlug: "person.audible",
								relationshipProperties: { roles: ["Author", "Narrator"] },
							},
						],
					});
					expect(result.relatedEntityGroups?.[1]?.entities).toEqual([
						{
							name: "The Saga",
							externalId: "series-1",
							providerSlug: "audiobook-group.audible",
							relationshipProperties: { roles: ["Member"] },
						},
					]);
					expect(result.properties).toEqual({
						isNsfw: true,
						runtime: 610,
						publishYear: 2020,
						providerRating: 4.5,
						publishDate: "2020-05-02",
						description: "Line one\nLine two",
						genres: ["Science Fiction", "Fantasy"],
						unlinkedCreators: [{ role: "Author", name: "No Asin" }],
						sourceUrl: "https://www.audible.com/pd/mixed-book",
						images: [{ type: "remote", url: "https://img/big.jpg" }],
					});
					return undefined;
				}),
			),
		);
	});
});
