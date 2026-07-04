import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search, translate } from "./tvdb.sandbox";

type TvdbHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: TvdbHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getCachedValue: () => Promise.resolve({ success: true as const, data: "Bearer test-token" }),
		setCachedValue: () => Promise.resolve({ success: true as const, data: null }),
		getAppConfigValue: () => Promise.resolve({ success: true as const, data: "test-api-key" }),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("show.tvdb sandbox script", () => {
	it("dedupes seasons by number, keeps only official ones sorted by number", () => {
		const requested: string[] = [];
		const host = makeHost((_method, url) => {
			const { pathname } = new URL(url);
			requested.push(pathname);
			if (pathname.endsWith("/series/1/extended")) {
				return httpSuccess({
					data: {
						slug: "my-show",
						name: "My Show",
						seasons: [
							{ id: 101, number: 1 },
							{ id: 999, number: 1 },
							{ id: 102, number: 2 },
							{ id: 100, number: 0 },
						],
					},
				});
			}
			if (pathname.includes("/translations/")) {
				return httpSuccess({ data: {} });
			}
			if (pathname.endsWith("/seasons/101/extended")) {
				return httpSuccess({
					data: {
						id: 101,
						number: 1,
						year: "2020",
						image: "s1.jpg",
						type: { type: "official" },
						episodes: [
							{
								id: 11,
								number: 1,
								runtime: 42,
								name: "Pilot",
								aired: "2020-01-01",
								image: "e1.jpg",
								overview: "ov",
							},
							{ id: 12, number: 2 },
						],
					},
				});
			}
			if (pathname.endsWith("/seasons/102/extended")) {
				return httpSuccess({
					data: {
						id: 102,
						number: 2,
						type: { type: "official" },
						episodes: [{ id: 21, number: 1, name: "S2E1" }],
					},
				});
			}
			if (pathname.endsWith("/seasons/100/extended")) {
				return httpSuccess({ data: { id: 100, number: 0, type: { type: "alternate" } } });
			}
			return httpSuccess({ data: {} });
		});

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).then((result) => {
			expect(requested).toEqual(
				expect.arrayContaining([
					"/v4/seasons/101/extended",
					"/v4/seasons/102/extended",
					"/v4/seasons/100/extended",
				]),
			);
			expect(requested).not.toContain("/v4/seasons/999/extended");
			expect(result.childEntities).toEqual([
				{
					childEntities: [
						{
							name: "Pilot",
							externalId: "11",
							entitySchemaSlug: "show-episode",
							properties: {
								runtime: 42,
								seasonNumber: 1,
								description: "ov",
								episodeNumber: 1,
								parentShowExternalId: "1",
								publishDate: "2020-01-01",
								images: [{ type: "remote", url: "e1.jpg" }],
							},
						},
						{
							name: "Episode 2",
							externalId: "12",
							entitySchemaSlug: "show-episode",
							properties: {
								runtime: null,
								seasonNumber: 1,
								description: null,
								episodeNumber: 2,
								publishDate: null,
								parentShowExternalId: "1",
							},
						},
					],
					externalId: "101",
					name: "Season 1",
					entitySchemaSlug: "show-season",
					properties: {
						seasonNumber: 1,
						releaseDate: "2020-01-01",
						parentShowExternalId: "1",
						images: [{ type: "remote", url: "s1.jpg" }],
					},
				},
				{
					childEntities: [
						{
							name: "S2E1",
							externalId: "21",
							entitySchemaSlug: "show-episode",
							properties: {
								runtime: null,
								seasonNumber: 2,
								description: null,
								episodeNumber: 1,
								publishDate: null,
								parentShowExternalId: "1",
							},
						},
					],
					externalId: "102",
					name: "Season 2",
					entitySchemaSlug: "show-season",
					properties: {
						seasonNumber: 2,
						releaseDate: null,
						parentShowExternalId: "1",
					},
				},
			]);
			expect(result.properties).toEqual({
				genres: [],
				images: [],
				publishYear: null,
				description: null,
				totalSeasons: 2,
				totalEpisodes: 3,
				unlinkedCreators: [],
				sourceUrl: "https://thetvdb.com/series/my-show",
			});
			return undefined;
		});
	});

	it("applies translation overrides, year fallback, numeric sourceUrl, merged relations", () => {
		const host = makeHost((_method, url) => {
			const { pathname } = new URL(url);
			if (pathname.includes("/translations/")) {
				return httpSuccess({ data: { name: "Localized Name", overview: "Localized Desc" } });
			}
			return httpSuccess({
				data: {
					name: "Canonical Name",
					year: "not-a-year",
					firstAired: "2015-06-01",
					characters: [
						{ peopleId: 5, personName: "Alice", peopleType: "Actor" },
						{ peopleId: 5, personName: "Alice", peopleType: "Director" },
						{ personName: "Bob", peopleType: "Writer" },
					],
					companies: {
						studio: [{ id: 7, name: "Studio X" }],
						network: [{ id: 7, name: "Studio X" }],
					},
					seasons: [],
				},
			});
		});

		return runSandboxTestDriver(details, { externalId: "123" }, host, execution).then((result) => {
			expect(result.name).toBe("Localized Name");
			expect(result.properties).toEqual({
				genres: [],
				images: [],
				publishYear: 2015,
				totalSeasons: 0,
				totalEpisodes: 0,
				description: "Localized Desc",
				unlinkedCreators: [{ name: "Bob", role: "Writer" }],
				sourceUrl: "https://thetvdb.com/series/123",
			});
			expect(result.relatedEntityGroups).toEqual([
				{
					direction: "incoming",
					synchronization: "additive",
					relationshipSchemaSlug: "person-to-show",
					entities: [
						{
							name: "Alice",
							externalId: "5",
							scriptSlug: "person.tvdb",
							relationshipProperties: { roles: ["Actor", "Director"] },
						},
					],
				},
				{
					direction: "incoming",
					synchronization: "additive",
					relationshipSchemaSlug: "company-to-show",
					entities: [
						{
							name: "Studio X",
							externalId: "7",
							scriptSlug: "company.tvdb",
							relationshipProperties: { roles: ["Studio", "Network"] },
						},
					],
				},
			]);
			return undefined;
		});
	});

	it("derives season and episode translation paths from the parent show id", () => {
		const requested: Array<{ method: string; path: string }> = [];
		const host = makeHost((method, url) => {
			const { pathname } = new URL(url);
			requested.push({ method, path: pathname });
			if (pathname.includes("/translations/")) {
				return httpSuccess({ data: { name: "Localized", overview: "Localized Desc" } });
			}
			return httpSuccess({
				data: {
					artworks: [
						{ language: "eng", image: "art.jpg" },
						{ language: "fra", image: "x" },
					],
				},
			});
		});

		return runSandboxTestDriver(
			translate,
			{
				language: "en",
				externalId: "555",
				entitySchemaSlug: "show-season",
				properties: { parentShowExternalId: "10" },
			},
			host,
			execution,
		)
			.then((seasonResult) => {
				expect(requested).toContainEqual({
					method: "GET",
					path: "/v4/seasons/555/extended",
				});
				expect(requested).toContainEqual({
					method: "GET",
					path: "/v4/seasons/555/translations/eng",
				});
				expect(seasonResult).toEqual({
					name: "Localized",
					properties: {
						description: "Localized Desc",
						images: [{ type: "remote", url: "art.jpg" }],
					},
				});
				return runSandboxTestDriver(
					translate,
					{
						language: "en",
						externalId: "777",
						entitySchemaSlug: "show-episode",
						properties: { parentShowExternalId: "10" },
					},
					host,
					execution,
				);
			})
			.then(() => {
				expect(requested).toContainEqual({
					method: "GET",
					path: "/v4/episodes/777/extended",
				});
				expect(requested).toContainEqual({
					method: "GET",
					path: "/v4/episodes/777/translations/eng",
				});
				return undefined;
			});
	});

	it("rejects an unsupported translation entity schema", () => {
		const host = makeHost(() => httpSuccess({ data: {} }));
		return expect(
			runSandboxTestDriver(
				translate,
				{
					externalId: "1",
					language: "en",
					entitySchemaSlug: "person",
					properties: { parentShowExternalId: "10" },
				},
				host,
				execution,
			),
		).rejects.toThrow("show.tvdb translate supports only show, show-season, and show-episode");
	});

	it("maps search results with name-to-title fallback and pagination", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: [
					{ tvdb_id: "42", name: "Found Show", poster: "p.jpg" },
					{ tvdb_id: "43", title: "Title Only" },
				],
				links: { next: "https://api4.thetvdb.com/v4/search?offset=20" },
			}),
		);

		return runSandboxTestDriver(
			search,
			{ query: "test", page: 1, pageSize: 20 },
			host,
			execution,
		).then((result) => {
			expect(result.items).toEqual([
				{
					externalId: "42",
					titleProperty: { kind: "text", value: "Found Show" },
					calloutProperty: { kind: "null", value: null },
					primarySubtitleProperty: { kind: "null", value: null },
					secondarySubtitleProperty: { kind: "null", value: null },
					imageProperty: { kind: "image", value: { type: "remote", url: "p.jpg" } },
				},
				{
					externalId: "43",
					titleProperty: { kind: "text", value: "Title Only" },
					calloutProperty: { kind: "null", value: null },
					primarySubtitleProperty: { kind: "null", value: null },
					secondarySubtitleProperty: { kind: "null", value: null },
					imageProperty: { kind: "null", value: null },
				},
			]);
			expect(result.details).toEqual({ totalItems: 2, nextPage: 2 });
			return undefined;
		});
	});
});
