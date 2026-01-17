import type { SandboxHost } from "@ryot/sandbox-sdk";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search, translate } from "./tvdb.sandbox";

type TvdbHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: {
			status: 200,
			headers: {},
			body: typeof body === "string" ? body : JSON.stringify(body),
		},
	});

const makeHost = (httpCall: TvdbHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getCachedValue: () => Promise.resolve({ success: true as const, data: "Bearer test-token" }),
		setCachedValue: () => Promise.resolve({ success: true as const, data: null }),
		getAppConfigValue: () => Promise.resolve({ success: true as const, data: "test-api-key" }),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("movie.tvdb sandbox script", () => {
	it("maps only official lists, merges duplicate person roles, and preserves group order", () => {
		const host = makeHost((_method, url) =>
			url.includes("/translations/")
				? httpSuccess({})
				: httpSuccess({
						data: {
							name: "Movie",
							companies: { studio: [{ id: 5, name: "Studio X" }] },
							characters: [
								{ peopleId: 1, personName: "Actor A", peopleType: "Actor" },
								{ peopleId: 1, personName: "Actor A", peopleType: "Director" },
								{ personName: "Unlinked Person", peopleType: "Writer" },
							],
							lists: [
								{ id: 10, name: "Official List", is_official: true },
								{ id: "20", name: "String Id List", isOfficial: true },
								{ id: 30, name: "Unofficial", is_official: false },
								{ name: "No Id", is_official: true },
							],
						},
					}),
		);

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).then((result) => {
			expect(result.relatedEntityGroups).toEqual([
				{
					direction: "incoming",
					synchronization: "additive",
					relationshipSchemaSlug: "person-to-movie",
					entities: [
						{
							name: "Actor A",
							externalId: "1",
							scriptSlug: "person.tvdb",
							relationshipProperties: { roles: ["Actor", "Director"] },
						},
					],
				},
				{
					direction: "incoming",
					synchronization: "additive",
					relationshipSchemaSlug: "company-to-movie",
					entities: [
						{
							name: "Studio X",
							externalId: "5",
							scriptSlug: "company.tvdb",
							relationshipProperties: { roles: ["Studio"] },
						},
					],
				},
				{
					direction: "incoming",
					synchronization: "additive",
					relationshipSchemaSlug: "movie-group-to-movie",
					entities: [
						{
							externalId: "10",
							name: "Official List",
							scriptSlug: "movie-group.tvdb",
							relationshipProperties: { roles: ["Member"] },
						},
						{
							externalId: "20",
							name: "String Id List",
							scriptSlug: "movie-group.tvdb",
							relationshipProperties: { roles: ["Member"] },
						},
					],
				},
			]);
			expect(result.properties).toMatchObject({
				unlinkedCreators: [{ name: "Unlinked Person", role: "Writer" }],
			});
			return undefined;
		});
	});

	it("applies translation name and description over the base movie fields", () => {
		const host = makeHost((_method, url) =>
			url.includes("/translations/")
				? httpSuccess({ data: { name: "Translated Name", overview: "Translated overview" } })
				: httpSuccess({ data: { name: "Base Name", overview: "Base overview", year: "2020" } }),
		);

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).then((result) => {
			expect(result.name).toBe("Translated Name");
			expect(result.properties).toMatchObject({
				publishYear: 2020,
				description: "Translated overview",
			});
			return undefined;
		});
	});

	it("falls back to the movie title key and firstAired year, and omits runtime and sourceUrl", () => {
		const host = makeHost((_method, url) =>
			url.includes("/translations/")
				? httpSuccess({})
				: httpSuccess({
						data: { averageRuntime: 0, title: "Only Title Key", firstAired: "2019-05-01" },
					}),
		);

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).then((result) => {
			expect(result.name).toBe("Only Title Key");
			expect(result.properties).toMatchObject({
				runtime: null,
				sourceUrl: null,
				publishYear: 2019,
				description: null,
			});
			return undefined;
		});
	});

	it("deduplicates images across image, image_url, and artworks", () => {
		const host = makeHost((_method, url) =>
			url.includes("/translations/")
				? httpSuccess({})
				: httpSuccess({
						data: {
							name: "Movie",
							image: "http://a",
							image_url: "http://a",
							artworks: [{ image: "http://b" }, { image: "http://a" }, { image: "http://c" }],
						},
					}),
		);

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).then((result) => {
			expect(result.properties).toMatchObject({
				images: [
					{ type: "remote", url: "http://a" },
					{ type: "remote", url: "http://b" },
					{ type: "remote", url: "http://c" },
				],
			});
			return undefined;
		});
	});

	it("translate uses the localized artwork from the extended payload", () => {
		const host = makeHost((_method, url) =>
			url.includes("/translations/")
				? httpSuccess({ data: { name: "Nombre", overview: "Descripción" } })
				: httpSuccess({
						data: {
							artworks: [
								{ language: "spa", image: "http://poster-es" },
								{ language: "eng", image: "http://poster-en" },
							],
						},
					}),
		);

		return runSandboxTestDriver(
			translate,
			{ externalId: "1", language: "es", entitySchemaSlug: "movie" },
			host,
			execution,
		).then((result) => {
			expect(result).toEqual({
				name: "Nombre",
				properties: {
					description: "Descripción",
					images: [{ type: "remote", url: "http://poster-es" }],
				},
			});
			return undefined;
		});
	});

	it("translate still returns the translation when the details fetch fails", () => {
		const host = makeHost((_method, url) =>
			url.includes("/extended")
				? Promise.resolve({ success: false as const, error: "boom", data: { status: 500 } })
				: httpSuccess({ data: { name: "Nombre", overview: "Descripción" } }),
		);

		return runSandboxTestDriver(
			translate,
			{ externalId: "1", language: "es", entitySchemaSlug: "movie" },
			host,
			execution,
		).then((result) => {
			expect(result).toEqual({ name: "Nombre", properties: { description: "Descripción" } });
			return undefined;
		});
	});

	it("search maps items from tvdb_id with totalItems fallback and links.next", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: [{ tvdb_id: "movie-1", name: "Batman" }],
				links: { next: "http://next", total_items: null },
			}),
		);

		return runSandboxTestDriver(
			search,
			{ query: "batman", page: 1, pageSize: 20 },
			host,
			execution,
		).then((result) => {
			expect(result).toEqual({
				items: [
					{
						externalId: "movie-1",
						titleProperty: { kind: "text", value: "Batman" },
						calloutProperty: { kind: "null", value: null },
						imageProperty: { kind: "null", value: null },
						primarySubtitleProperty: { kind: "null", value: null },
						secondarySubtitleProperty: { kind: "null", value: null },
					},
				],
				details: { totalItems: 1, nextPage: 2 },
			});
			return undefined;
		});
	});
});
