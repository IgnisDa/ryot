import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./shared";

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
					{ record: { id: 4 }, hit_name: "Author Name" },
					{ hit_name: "No Record" },
					{ record: { id: 5 } },
				],
			}),
		);

		return runSandboxTestScript(
			search,
			{ page: 1, pageSize: 20, query: "author" },
			host,
			execution,
		).pipe(
			Effect.map((result) => {
				expect(result.items).toEqual([{ externalId: "4", title: "Author Name" }]);
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
				birthday: { day: 7, month: 3, year: 1980 },
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
					gender: "Female",
					description: null,
					alternateNames: [],
					birthDate: "1980-03-07",
					birthPlace: "Osaka, Japan",
					sourceUrl: "https://www.mangaupdates.com/authors/4",
					images: [{ type: "remote", purpose: "profile", url: "https://img/author.jpg" }],
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
				: httpSuccess({ name: "Author Name", birthday: { day: 7, month: 13, year: 1980 } }),
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
