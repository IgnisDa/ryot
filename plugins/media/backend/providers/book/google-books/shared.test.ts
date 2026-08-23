import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import details, { manifest as detailsManifest } from "./details.sandbox";
import resolve, { manifest as resolveManifest } from "./resolve.sandbox";
import search, { manifest as searchManifest } from "./search.sandbox";
import { manifest } from "./shared";

type GoogleBooksHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: GoogleBooksHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getPluginConfig: (keys) =>
			Effect.succeed(Object.fromEntries(keys.map((key) => [key, "google-key"]))),
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
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			expect(requestUrl.host).toBe("www.googleapis.com");
			expect(requestUrl.pathname).toBe("/books/v1/volumes");
			expect(requestUrl.searchParams.get("q")).toBe("intitle:g");
			return httpSuccess({
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
			});
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { page: 1, query: "g", pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{ title: "G Book", metadata: [2010], externalId: "g1", imageUrl: "https://img/t.jpg" },
					]);
					expect(result.details).toEqual({ totalItems: 2, nextPage: null });
					return undefined;
				}),
			),
		);
	});

	it("passes raw search queries when requested", () => {
		const host = makeHost((_method, url) => {
			expect(new URL(url).searchParams.get("q")).toBe("isbn:9781234567890");
			return httpSuccess({ items: [], totalItems: 0 });
		});
		return Effect.runPromise(
			runSandboxTestScript(
				search,
				{ page: 1, pageSize: 20, query: "isbn:9781234567890", options: { passRawQuery: true } },
				host,
				execution,
			),
		);
	});
	it("rejects invalid search options", async () => {
		const host = makeHost(() => httpSuccess({ items: [], totalItems: 0 }));

		await expect(
			Effect.runPromise(
				runSandboxTestScript(
					search,
					{ page: 1, pageSize: 20, query: "book", options: { passRawQuery: "yes" } },
					host,
					execution,
				),
			),
		).rejects.toBeDefined();
		await expect(
			Effect.runPromise(
				runSandboxTestScript(
					search,
					{ page: 1, pageSize: 20, query: "book", options: { unsupported: true } },
					host,
					execution,
				),
			),
		).rejects.toBeDefined();
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
					imageLinks: { small: "https://img/s.jpg", thumbnail: "https://img/t.jpg" },
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
							{ name: "Pub", role: "Publisher" },
						],
						images: [
							{ type: "remote", purpose: "cover", url: "https://img/t.jpg" },
							{ type: "remote", purpose: "cover", url: "https://img/s.jpg" },
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
