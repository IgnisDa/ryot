import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, resolve, search } from "./openlibrary.sandbox";

type OpenLibraryBookHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: OpenLibraryBookHost["httpCall"]) =>
	defineSandboxTestHost(manifest, { httpCall });

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("book.openlibrary sandbox script", () => {
	it("maps search docs and drops docs missing a key or title", () => {
		const host = makeHost(() =>
			httpSuccess({
				num_found: 2,
				docs: [
					{ key: "/works/OL1W", title: "The Work", first_publish_year: 2001, cover_i: 111 },
					{ key: "/works/OL2W", title: "" },
				],
			}),
		);

		return runSandboxTestDriver(
			search,
			{ query: "work", page: 1, pageSize: 20 },
			host,
			execution,
		).then((result) => {
			expect(result.items).toEqual([
				{
					externalId: "OL1W",
					calloutProperty: { kind: "null", value: null },
					titleProperty: { kind: "text", value: "The Work" },
					primarySubtitleProperty: { kind: "number", value: 2001 },
					secondarySubtitleProperty: { kind: "null", value: null },
					imageProperty: {
						kind: "image",
						value: {
							type: "remote",
							url: "https://covers.openlibrary.org/b/id/111-M.jpg?default=false",
						},
					},
				},
			]);
			expect(result.details).toEqual({ totalItems: 2, nextPage: null });
			return undefined;
		});
	});

	it("chooses the earliest custom-parsed date and resolves author names", () => {
		const host = makeHost((_method, url) => {
			if (url.includes("/editions.json")) {
				return httpSuccess({
					entries: [
						{ number_of_pages: 320, publish_date: "May 5, 2001", covers: [222] },
						{ publish_date: "1999" },
					],
				});
			}
			if (url.includes("/authors/OL1A.json")) {
				return httpSuccess({ name: "Author Name" });
			}
			return httpSuccess({
				covers: [111],
				title: "The Work",
				key: "/works/OL1W",
				subjects: ["Fiction, Fantasy"],
				description: { value: "Desc." },
				authors: [{ author: { key: "/authors/OL1A" } }],
			});
		});

		return runSandboxTestDriver(details, { externalId: "OL1W" }, host, execution).then((result) => {
			expect(result.name).toBe("The Work");
			expect(result.relatedEntityGroups).toEqual([
				{
					direction: "incoming",
					synchronization: "authoritative",
					relationshipSchemaSlug: "person-to-book",
					entities: [
						{
							externalId: "OL1A",
							name: "Author Name",
							scriptSlug: "person.openlibrary",
							relationshipProperties: { roles: ["Author"] },
						},
					],
				},
			]);
			expect(result.properties).toEqual({
				pages: 320,
				publishYear: 1999,
				description: "Desc.",
				genres: ["Fiction", "Fantasy"],
				sourceUrl: "https://openlibrary.org/works/OL1W/The Work",
				images: [
					{ type: "remote", url: "https://covers.openlibrary.org/b/id/111-M.jpg?default=false" },
					{ type: "remote", url: "https://covers.openlibrary.org/b/id/222-M.jpg?default=false" },
				],
			});
			return undefined;
		});
	});

	it("resolves ISBNs to a work id and treats 404 as unresolved", () => {
		const found = makeHost(() => httpSuccess({ works: [{ key: "/works/OL1W" }] }));
		const missing = makeHost(() =>
			Promise.resolve({ success: false as const, error: "not found", data: { status: 404 } }),
		);

		return Promise.all([
			runSandboxTestDriver(resolve, { value: "123", identifierType: "isbn" }, found, execution),
			runSandboxTestDriver(resolve, { value: "999", identifierType: "isbn" }, missing, execution),
		]).then(([foundResult, missingResult]) => {
			expect(foundResult).toEqual({ externalId: "OL1W" });
			expect(missingResult).toEqual({ externalId: null });
			return undefined;
		});
	});
});
