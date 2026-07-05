import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, resolve, search } from "./google-books.sandbox";

type GoogleBooksHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: GoogleBooksHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Promise.resolve({ success: true as const, data: "google-key" }),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("book.google-books sandbox script", () => {
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

		return runSandboxTestDriver(
			search,
			{ query: "g", page: 1, pageSize: 20 },
			host,
			execution,
		).then((result) => {
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
		});
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

		return runSandboxTestDriver(details, { externalId: "g1" }, host, execution).then((result) => {
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
		});
	});

	it("resolves ISBNs to a volume id and null when absent", () => {
		const found = makeHost(() => httpSuccess({ items: [{ id: "g1" }] }));
		const missing = makeHost(() => httpSuccess({ items: [] }));

		return Promise.all([
			runSandboxTestDriver(resolve, { value: "123", identifierType: "isbn" }, found, execution),
			runSandboxTestDriver(resolve, { value: "999", identifierType: "isbn" }, missing, execution),
		]).then(([foundResult, missingResult]) => {
			expect(foundResult).toEqual({ externalId: "g1" });
			expect(missingResult).toEqual({ externalId: null });
			return undefined;
		});
	});
});
