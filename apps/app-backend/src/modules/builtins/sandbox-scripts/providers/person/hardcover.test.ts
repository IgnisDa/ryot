import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./hardcover.sandbox";

type HardcoverPersonHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: HardcoverPersonHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Promise.resolve({ success: true as const, data: "hardcover-key" }),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("person.hardcover sandbox script", () => {
	it("maps author hits and drops documents missing a name", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					search: {
						results: {
							found: 1,
							hits: [
								{ document: { id: "7", name: "Jane Doe", image: { url: "https://img/j.jpg" } } },
								{ document: { id: "8" } },
							],
						},
					},
				},
			}),
		);

		return runSandboxTestDriver(
			search,
			{ query: "jane", page: 1, pageSize: 20 },
			host,
			execution,
		).then((result) => {
			expect(result.items).toEqual([
				{
					externalId: "7",
					calloutProperty: { kind: "null", value: null },
					titleProperty: { kind: "text", value: "Jane Doe" },
					primarySubtitleProperty: { kind: "null", value: null },
					secondarySubtitleProperty: { kind: "null", value: null },
					imageProperty: { kind: "image", value: { type: "remote", url: "https://img/j.jpg" } },
				},
			]);
			return undefined;
		});
	});

	it("emits authored books, website, alternate names and dates", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					authors_by_pk: {
						id: "7",
						bio: "Bio.",
						name: "Jane Doe",
						slug: "jane-doe",
						death_date: null,
						born_date: "1970-01-01",
						image: { url: "https://img/j.jpg" },
						links: [{ url: "https://jane.example" }],
						alternate_names: ["J. Doe", "Janey"],
						contributions: [{ contribution: "Author", book: { id: 42, title: "The Book" } }],
					},
				},
			}),
		);

		return runSandboxTestDriver(details, { externalId: "7" }, host, execution).then((result) => {
			expect(result.name).toBe("Jane Doe");
			expect(result.relatedEntityGroups).toEqual([
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "person-to-book",
					entities: [
						{
							name: "The Book",
							externalId: "42",
							scriptSlug: "book.hardcover",
							relationshipProperties: { roles: ["Author"] },
						},
					],
				},
			]);
			expect(result.properties).toEqual({
				description: "Bio.",
				deathDate: null,
				birthDate: "1970-01-01",
				alternateNames: ["J. Doe", "Janey"],
				website: "https://jane.example",
				sourceUrl: "https://hardcover.app/authors/jane-doe",
				images: [{ type: "remote", url: "https://img/j.jpg" }],
			});
			return undefined;
		});
	});
});
