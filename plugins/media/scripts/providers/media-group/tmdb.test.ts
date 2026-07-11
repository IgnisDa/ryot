import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, translate } from "./tmdb";

type TmdbHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: TmdbHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Effect.succeed("token"),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("movie-group.tmdb sandbox script", () => {
	it("normalizes collection names and keeps ordered movie relationships", () => {
		const host = makeHost((_method, url) =>
			url.includes("/images")
				? httpSuccess({ posters: [], backdrops: [] })
				: httpSuccess({
						poster_path: null,
						backdrop_path: null,
						overview: "Three films",
						name: "Example Collection",
						parts: [
							{ id: 2, title: "First" },
							{ id: 3, title: "Second" },
						],
					}),
		);

		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result).toMatchObject({
						name: "Example",
						properties: { parts: 2, description: "Three films" },
						relatedEntityGroups: [
							{
								direction: "outgoing",
								synchronization: "authoritative",
								relationshipSchemaSlug: "movie-group-to-movie",
								entities: [
									{
										name: "First",
										externalId: "2",
										providerSlug: "movie.tmdb",
										relationshipProperties: { order: 1 },
									},
									{
										name: "Second",
										externalId: "3",
										providerSlug: "movie.tmdb",
										relationshipProperties: { order: 2 },
									},
								],
							},
						],
					});
				}),
			),
		);
	});

	it("translates and normalizes collection names", () => {
		const host = makeHost((_method, url) =>
			url.includes("/images")
				? httpSuccess({ posters: [{ iso_639_1: "fr", file_path: "/poster.jpg" }] })
				: httpSuccess({
						translations: [
							{
								iso_639_1: "fr",
								iso_3166_1: "FR",
								data: { title: "Exemple Collection", overview: "Description" },
							},
						],
					}),
		);

		return Effect.runPromise(
			runSandboxTestScript(
				translate,
				{ externalId: "1", language: "fr-FR", entitySchemaSlug: "movie-group" },
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result).toEqual({
						name: "Exemple",
						properties: {
							description: "Description",
							images: [{ type: "remote", url: "https://image.tmdb.org/t/p/original/poster.jpg" }],
						},
					});
				}),
			),
		);
	});
});
