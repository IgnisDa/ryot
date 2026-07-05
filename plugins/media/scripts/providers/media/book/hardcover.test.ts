import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { manifest } from "./hardcover";
import details, { manifest as detailsManifest } from "./hardcover-details.sandbox";
import resolve, { manifest as resolveManifest } from "./hardcover-resolve.sandbox";
import search, { manifest as searchManifest } from "./hardcover-search.sandbox";

type HardcoverBookHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (httpCall: HardcoverBookHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getPluginConfigValue: () => Effect.succeed("hardcover-key"),
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("book.hardcover sandbox script", () => {
	it("declares one script per operation", () => {
		expect([
			[searchManifest.slug, search.operation],
			[detailsManifest.slug, details.operation],
			[resolveManifest.slug, resolve.operation],
		]).toEqual([
			["book.hardcover.search", "search"],
			["book.hardcover.details", "details"],
			["book.hardcover.resolve", "resolve"],
		]);
	});
	it("maps search hits and drops documents missing an id or title", () => {
		const host = makeHost((_method, url) => {
			expect(new URL(url).host).toBe("api.hardcover.app");
			return httpSuccess({
				data: {
					search: {
						results: {
							found: 3,
							hits: [
								{
									document: {
										id: "b1",
										title: "Book One",
										release_year: 2020,
										image: { url: "https://img/1.jpg" },
									},
								},
								{ document: { id: "b2", title: "" } },
								{ document: { title: "No Id" } },
							],
						},
					},
				},
			});
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { query: "book", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{
							externalId: "b1",
							calloutProperty: { kind: "null", value: null },
							titleProperty: { kind: "text", value: "Book One" },
							primarySubtitleProperty: { kind: "number", value: 2020 },
							secondarySubtitleProperty: { kind: "null", value: null },
							imageProperty: { kind: "image", value: { type: "remote", url: "https://img/1.jpg" } },
						},
					]);
					expect(result.details).toEqual({ totalItems: 3, nextPage: null });
					return undefined;
				}),
			),
		);
	});
	it("groups contributors, publishers and series, merging duplicate contributor roles", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					books_by_pk: {
						id: "42",
						pages: 300,
						slug: "the-book",
						title: "The Book",
						release_year: 2020,
						description: "A book.",
						release_date: "2020-01-01",
						images: [{ url: "https://img/alt.jpg" }],
						image: { url: "https://img/cover.jpg" },
						cached_tags: { Genre: [{ tag: "science fiction" }, { tag: "ADVENTURE" }] },
						book_series: [
							{
								series: { id: 100, name: "The Series" },
								publisher: { id: 200, name: "Pub House" },
							},
						],
						contributions: [
							{ contribution: "Author", author_id: 7, author: { name: "Jane Doe" } },
							{ contribution: "Editor", author_id: 7, author: { name: "Jane Doe" } },
						],
					},
				},
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "42" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("The Book");
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "person-to-book",
							entities: [
								{
									name: "Jane Doe",
									externalId: "7",
									providerSlug: "person.hardcover",
									relationshipProperties: { roles: ["Author", "Editor"] },
								},
							],
						},
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "company-to-book",
							entities: [
								{
									name: "Pub House",
									externalId: "200",
									providerSlug: "company.hardcover",
									relationshipProperties: { roles: ["Publisher"] },
								},
							],
						},
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "book-group-to-book",
							entities: [
								{
									name: "The Series",
									externalId: "100",
									providerSlug: "book-group.hardcover",
									relationshipProperties: { roles: ["Member"] },
								},
							],
						},
					]);
					expect(result.properties).toEqual({
						pages: 300,
						publishYear: 2020,
						unlinkedCreators: [],
						description: "A book.",
						publishDate: "2020-01-01",
						genres: ["Science Fiction", "Adventure"],
						sourceUrl: "https://hardcover.app/books/the-book",
						images: [
							{ type: "remote", url: "https://img/cover.jpg" },
							{ type: "remote", url: "https://img/alt.jpg" },
						],
					});
					return undefined;
				}),
			),
		);
	});
});
