import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { describe, expect, it } from "vitest";

import details, { manifest as detailsManifest } from "./details.sandbox";
import resolve, { manifest as resolveManifest } from "./resolve.sandbox";
import search, { manifest as searchManifest } from "./search.sandbox";
import { manifest } from "./shared";
import translate, { manifest as translateManifest } from "./translate.sandbox";
import trending, { manifest as trendingManifest } from "./trending.sandbox";

type TmdbHost = Pick<ScriptHost, "httpCall" | "getPluginConfig" | "getUserSettings">;
const httpSuccess = (body: unknown) =>
	Effect.succeed({
		status: 200,
		headers: {},
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
const makeHost = (httpCall: TmdbHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getUserSettings: () => Effect.succeed({ allowNsfw: false }),
		getPluginConfig: ({ required: keys = [] }) =>
			Effect.succeed(Object.fromEntries(keys.map((key) => [key, "token"]))),
	});
type MovieFixtures = {
	movie: Record<string, unknown>;
	images?: unknown;
	appended?: Record<string, unknown>;
};
const makeMovieHost = (fixtures: MovieFixtures, requests: URL[] = []) =>
	makeHost((_method, url) => {
		const requestUrl = new URL(url);
		requests.push(requestUrl);
		if (requestUrl.pathname === "/3/movie/1") {
			const keys = (requestUrl.searchParams.get("append_to_response") ?? "").split(",");
			return httpSuccess({
				...fixtures.movie,
				...Object.fromEntries(
					keys.flatMap((key) =>
						fixtures.appended && key in fixtures.appended ? [[key, fixtures.appended[key]]] : [],
					),
				),
			});
		}
		return httpSuccess(fixtures.images ?? { posters: [], backdrops: [] });
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
const image = (purpose: string, path: string) => ({
	purpose,
	type: "remote",
	url: `https://image.tmdb.org/t/p/original${path}`,
});

describe("movie.tmdb sandbox script", () => {
	it("declares a script for each operation", () => {
		expect([
			[searchManifest.slug, search.operation],
			[detailsManifest.slug, details.operation],
			[resolveManifest.slug, resolve.operation],
			[translateManifest.slug, translate.operation],
		]).toEqual([
			["movie.tmdb.search", "search"],
			["movie.tmdb.details", "details"],
			["movie.tmdb.resolve", "resolve"],
			["movie.tmdb.translate", "translate"],
		]);
	});

	it("declares trending as a generic provider-associated script", () => {
		expect({
			kind: trendingManifest.kind,
			slug: trendingManifest.slug,
			operation: "operation" in trending ? trending.operation : null,
		}).toEqual({ kind: "script", operation: null, slug: "movie.tmdb.trending" });
	});

	it("keeps TMDB recommendations as related entities", () => {
		const host = makeMovieHost({
			images: {
				posters: [{ file_path: "/poster-alt.jpg" }, { file_path: "/shared.jpg" }],
				backdrops: [{ file_path: "/shared.jpg" }, { file_path: "/backdrop-alt.jpg" }],
			},
			appended: {
				credits: { cast: [], crew: [] },
				"watch/providers": { results: {} },
				recommendations: {
					results: [
						{ id: 2, name: "Pick One", title: "Pick One" },
						{ id: 3, name: "Pick Two", title: "Pick Two" },
					],
				},
			},
			movie: {
				id: 1,
				genres: [],
				adult: false,
				runtime: 120,
				overview: null,
				title: "Source",
				vote_average: 7.5,
				status: "Released",
				production_companies: [],
				poster_path: "/poster.jpg",
				release_date: "2024-01-01",
				belongs_to_collection: null,
				backdrop_path: "/backdrop.jpg",
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.properties).toMatchObject({
						images: [
							{
								type: "remote",
								purpose: "cover",
								url: "https://image.tmdb.org/t/p/original/poster.jpg",
							},
							{
								type: "remote",
								purpose: "cover",
								url: "https://image.tmdb.org/t/p/original/poster-alt.jpg",
							},
							{
								type: "remote",
								purpose: "cover",
								url: "https://image.tmdb.org/t/p/original/shared.jpg",
							},
							{
								type: "remote",
								purpose: "backdrop",
								url: "https://image.tmdb.org/t/p/original/backdrop.jpg",
							},
							{
								type: "remote",
								purpose: "backdrop",
								url: "https://image.tmdb.org/t/p/original/backdrop-alt.jpg",
							},
						],
					});
					expect(result.relatedEntityGroups).toEqual([
						{
							entities: [],
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "person-to-movie",
						},
						{
							entities: [],
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "company-to-movie",
						},
						{
							entities: [],
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "movie-group-to-movie",
						},
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "media-suggestion",
							entities: [
								{ externalId: "2", name: "Pick One", providerSlug: "movie.tmdb" },
								{ externalId: "3", name: "Pick Two", providerSlug: "movie.tmdb" },
							],
						},
						{
							entities: [],
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "movie-to-genre",
						},
					]);
					return undefined;
				}),
			),
		);
	});

	it("appends only watch providers to the movie request at base level and omits credit and recommendation groups", () => {
		const requests: URL[] = [];
		const host = makeMovieHost(
			{
				movie: { id: 1, title: "Source" },
				appended: {
					credits: { crew: [], cast: [{ id: 5, name: "Actor" }] },
					recommendations: { results: [{ id: 2, title: "Pick" }] },
				},
			},
			requests,
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { level: "base", externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(
						requests.map(({ pathname, searchParams }) => [
							pathname,
							searchParams.get("append_to_response"),
							searchParams.get("language"),
						]),
					).toEqual([
						["/3/movie/1", "watch/providers", "en"],
						["/3/movie/1/images", null, null],
					]);
					expect(
						result.relatedEntityGroups?.map(({ relationshipSchemaSlug }) => relationshipSchemaSlug),
					).toEqual(["company-to-movie", "movie-group-to-movie"]);
					return undefined;
				}),
			),
		);
	});

	it("appends credits and recommendations to the movie request at full level and by default", () => {
		const requests: URL[] = [];
		const host = makeMovieHost({ movie: { id: 1, title: "Source" } }, requests);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.flatMap(() =>
					runSandboxTestScript(details, { level: "full", externalId: "1" }, host, execution),
				),
				Effect.map(() => {
					expect(
						requests.map(({ searchParams }) => searchParams.get("append_to_response")),
					).toEqual([
						"watch/providers,credits,recommendations",
						null,
						"watch/providers,credits,recommendations",
						null,
					]);
					return undefined;
				}),
			),
		);
	});

	it("requests movie images without a language and keeps every localized and unlocalized image", () => {
		const requests: URL[] = [];
		const host = makeMovieHost(
			{
				movie: {
					id: 1,
					title: "Source",
					poster_path: "/poster-main.jpg",
					backdrop_path: "/backdrop-main.jpg",
				},
				images: {
					backdrops: [
						{ iso_639_1: null, file_path: "/backdrop-none.jpg" },
						{ iso_639_1: "de", file_path: "/backdrop-de.jpg" },
					],
					posters: [
						{ iso_639_1: "fr", file_path: "/poster-fr.jpg" },
						{ iso_639_1: null, file_path: "/poster-none.jpg" },
						{ iso_639_1: "en", file_path: "/poster-main.jpg" },
					],
				},
			},
			requests,
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { level: "base", externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					const imagesRequest = requests.find(({ pathname }) => pathname.endsWith("/images"));
					expect(imagesRequest?.search).toBe("");
					expect(result.properties).toMatchObject({
						images: [
							image("cover", "/poster-main.jpg"),
							image("cover", "/poster-fr.jpg"),
							image("cover", "/poster-none.jpg"),
							image("backdrop", "/backdrop-main.jpg"),
							image("backdrop", "/backdrop-none.jpg"),
							image("backdrop", "/backdrop-de.jpg"),
						],
					});
					return undefined;
				}),
			),
		);
	});

	it("groups TMDB watch providers under each country that carries the movie", () => {
		const host = makeMovieHost({
			movie: { id: 1, title: "Source" },
			appended: {
				"watch/providers": {
					results: {
						AU: { flatrate: [{ logo_path: "/nameless.jpg" }] },
						GB: { buy: [{ logo_path: "/apple.jpg", provider_name: "Apple TV" }] },
						IN: { flatrate: [{ provider_name: "Netflix", logo_path: "/netflix.jpg" }] },
						US: {
							rent: [{ provider_name: "Netflix" }],
							link: "https://www.themoviedb.org/movie/1/watch?locale=US",
						},
					},
				},
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.properties).toMatchObject({
						watchProviders: [
							{
								link: null,
								country: "GB",
								providers: [
									{
										offers: ["buy"],
										name: "Apple TV",
										image: "https://image.tmdb.org/t/p/original/apple.jpg",
									},
								],
							},
							{
								link: null,
								country: "IN",
								providers: [
									{
										name: "Netflix",
										offers: ["stream"],
										image: "https://image.tmdb.org/t/p/original/netflix.jpg",
									},
								],
							},
							{
								country: "US",
								link: "https://www.themoviedb.org/movie/1/watch?locale=US",
								providers: [{ image: null, name: "Netflix", offers: ["rent"] }],
							},
						],
					});
					return undefined;
				}),
			),
		);
	});

	it("classifies localized movie posters as covers", () => {
		const host = makeHost((_method, url) =>
			url.includes("/movie/1/translations")
				? httpSuccess({
						translations: [{ iso_639_1: "fr", iso_3166_1: "FR", data: { title: "Film" } }],
					})
				: httpSuccess({ posters: [{ iso_639_1: "fr", file_path: "/poster-fr.jpg" }] }),
		);
		return Effect.runPromise(
			runSandboxTestScript(
				translate,
				{ externalId: "1", language: "fr-FR", entitySchemaSlug: "movie" },
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result.properties).toEqual({
						images: [
							{
								type: "remote",
								purpose: "cover",
								url: "https://image.tmdb.org/t/p/original/poster-fr.jpg",
							},
						],
					});
					return undefined;
				}),
			),
		);
	});

	it("returns TMDB trending movies", () => {
		const requestedPages: string[] = [];
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			expect(requestUrl.pathname).toBe("/3/trending/movie/day");
			requestedPages.push(requestUrl.searchParams.get("page") ?? "");
			if (requestUrl.searchParams.get("page") === "1") {
				return httpSuccess({
					results: [
						{ id: 1, title: "First Movie" },
						{ id: 2, original_title: "Second Movie" },
						{ id: 3, title: "" },
					],
				});
			}
			return requestUrl.searchParams.get("page") === "2"
				? httpSuccess({ results: [{ id: 4, title: "Third Movie" }] })
				: httpSuccess({ results: [{ id: 5, title: "Fourth Movie" }] });
		});
		return Effect.runPromise(
			runSandboxTestScript(trending, {}, host, execution).pipe(
				Effect.map((result) => {
					expect(requestedPages).toEqual(["1", "2", "3"]);
					expect(result).toEqual({
						items: [
							{ externalId: "1", name: "First Movie" },
							{ externalId: "2", name: "Second Movie" },
							{ externalId: "4", name: "Third Movie" },
							{ externalId: "5", name: "Fourth Movie" },
						],
					});
					return undefined;
				}),
			),
		);
	});
});
