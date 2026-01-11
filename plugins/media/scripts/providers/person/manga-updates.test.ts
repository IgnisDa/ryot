import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./manga-updates";

type MangaUpdatesPersonHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: MangaUpdatesPersonHost["httpCall"]) =>
	defineSandboxTestHost(manifest, { httpCall });

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("person.manga-updates sandbox script", () => {
	it("maps author search hits and drops entries without records or names", () => {
		const host = makeHost(() =>
			httpSuccess({
				total_hits: 1,
				results: [
					{ hit_name: "Author Name", record: { id: 4 } },
					{ hit_name: "No Record" },
					{ record: { id: 5 } },
				],
			}),
		);

		return runSandboxTestScript(
			search,
			{ query: "author", page: 1, pageSize: 20 },
			host,
			execution,
		).pipe(
			Effect.map((result) => {
				expect(result.items).toEqual([
					{
						externalId: "4",
						imageProperty: { kind: "null", value: null },
						calloutProperty: { kind: "null", value: null },
						titleProperty: { kind: "text", value: "Author Name" },
						primarySubtitleProperty: { kind: "null", value: null },
						secondarySubtitleProperty: { kind: "null", value: null },
					},
				]);
				expect(result.details).toEqual({ totalItems: 1, nextPage: null });
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("formats valid birthdays and emits authored series relationships", () => {
		const host = makeHost((method, url) => {
			if (method === "POST") {
				expect(url).toContain("/authors/4/series");
				return httpSuccess({
					series_list: [
						{ series_id: 11, title: "Series A" },
						{ series_id: 12 },
						{ title: "No Id" },
					],
				});
			}
			return httpSuccess({
				id: 4,
				gender: "Female",
				name: "Author Name",
				birthplace: "Osaka, Japan",
				birthday: { year: 1980, month: 3, day: 7 },
				image: { url: { original: "https://img/author.jpg" } },
			});
		});

		return runSandboxTestScript(details, { externalId: "4" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.name).toBe("Author Name");
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-manga",
						entities: [
							{
								name: "Series A",
								externalId: "11",
								providerSlug: "manga.manga-updates",
								relationshipProperties: { roles: ["Author"] },
							},
							{
								externalId: "12",
								name: "Loading...",
								providerSlug: "manga.manga-updates",
								relationshipProperties: { roles: ["Author"] },
							},
						],
					},
				]);
				expect(result.properties).toEqual({
					description: null,
					gender: "Female",
					alternateNames: [],
					birthDate: "1980-03-07",
					birthPlace: "Osaka, Japan",
					sourceUrl: "https://www.mangaupdates.com/authors/4",
					images: [{ type: "remote", url: "https://img/author.jpg" }],
				});
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("nulls out-of-range birthdays", () => {
		const host = makeHost((method) =>
			method === "POST"
				? httpSuccess({ series_list: [] })
				: httpSuccess({ name: "Author Name", birthday: { year: 1980, month: 13, day: 7 } }),
		);

		return runSandboxTestScript(details, { externalId: "4" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.properties).toMatchObject({ birthDate: null });
				return undefined;
			}),
			Effect.runPromise,
		);
	});
});
