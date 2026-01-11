import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { manifest } from "./google-books";
import details, { manifest as detailsManifest } from "./google-books-details.sandbox";
import resolve, { manifest as resolveManifest } from "./google-books-resolve.sandbox";
import search, { manifest as searchManifest } from "./google-books-search.sandbox";

type GoogleBooksHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (httpCall: GoogleBooksHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Effect.succeed("google-key"),
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("book.google-books sandbox script", () => {
	it("declares one script per operation", () => {
		expect([
			[searchManifest.slug, search.operation],
			[detailsManifest.slug, details.operation],
			[resolveManifest.slug, resolve.operation],
		]).toEqual([
			["book.google-books.search", "search"],
			["book.google-books.details", "details"],
			["book.google-books.resolve", "resolve"],
		]);
	});
	it("maps volumes and drops entries missing an id or title", () => {
		const host = makeHost(() =>
			httpSuccess({
				totalItems: 2,
				items: [
					{
						id: "g1",
						volumeInfo: {
							title: "G Book",
							publishedDate: "2010-06-01",
							imageLinks: { thumbnail: "https://img/t.jpg" },
						},
					},
					{ id: "g2", volumeInfo: { title: "" } },
				],
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(search, { query: "g", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{
							externalId: "g1",
							calloutProperty: { kind: "null", value: null },
							titleProperty: { kind: "text", value: "G Book" },
							primarySubtitleProperty: { kind: "number", value: 2010 },
							secondarySubtitleProperty: { kind: "null", value: null },
							imageProperty: { kind: "image", value: { type: "remote", url: "https://img/t.jpg" } },
						},
					]);
					expect(result.details).toEqual({ totalItems: 2, nextPage: null });
					return undefined;
				}),
			),
		);
	});
	it("maps categories, unlinked creators, images and pages on details", () => {
		const host = makeHost(() =>
			httpSuccess({
				id: "g1",
				volumeInfo: {
					pageCount: 250,
					title: "G Book",
					publisher: "Pub",
					description: "Desc.",
					authors: ["Author A"],
					publishedDate: "2010-06-01",
					mainCategory: "Best Seller",
					categories: ["Fiction / Fantasy"],
					imageLinks: { thumbnail: "https://img/t.jpg", small: "https://img/s.jpg" },
				},
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "g1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("G Book");
					expect(result.properties).toEqual({
						pages: 250,
						publishYear: 2010,
						description: "Desc.",
						genres: ["Fiction", "Fantasy", "Best Seller"],
						sourceUrl: "https://www.google.co.in/books/edition/G Book/g1",
						unlinkedCreators: [
							{ role: "Author", name: "Author A" },
							{ role: "Publisher", name: "Pub" },
						],
						images: [
							{ type: "remote", url: "https://img/t.jpg" },
							{ type: "remote", url: "https://img/s.jpg" },
						],
					});
					return undefined;
				}),
			),
		);
	});
	it("resolves ISBNs to a volume id and null when absent", () => {
		const found = makeHost(() => httpSuccess({ items: [{ id: "g1" }] }));
		const missing = makeHost(() => httpSuccess({ items: [] }));
		return Effect.runPromise(
			Effect.all([
				runSandboxTestScript(resolve, { value: "123", identifierType: "isbn" }, found, execution),
				runSandboxTestScript(resolve, { value: "999", identifierType: "isbn" }, missing, execution),
			]).pipe(
				Effect.map(([foundResult, missingResult]) => {
					expect(foundResult).toEqual({ externalId: "g1" });
					expect(missingResult).toEqual({ externalId: null });
					return undefined;
				}),
			),
		);
	});
});
