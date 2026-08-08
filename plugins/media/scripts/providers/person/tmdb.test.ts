import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest } from "./tmdb";
import translate from "./tmdb.translate.sandbox";

type TmdbHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: TmdbHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getPluginConfig: (keys) =>
			Effect.succeed(Object.fromEntries(keys.map((key) => [key, "token"]))),
		getUserPreferences: () => Effect.succeed({ allowNsfw: false, disableIntegrations: false }),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("person.tmdb sandbox script", () => {
	it("emits separate movie and show credit groups with roles", () => {
		const host = makeHost((_method, url) => {
			if (url.includes("/combined_credits")) {
				return httpSuccess({
					cast: [{ id: 2, media_type: "movie", title: "Film" }],
					crew: [{ id: 3, media_type: "tv", name: "Show", job: "Director" }],
				});
			}
			return httpSuccess({
				gender: 0,
				name: "Creator",
				also_known_as: [],
				profile_path: "/main.jpg",
				images: { profiles: [{ file_path: "/alt.jpg" }, { file_path: "/main.jpg" }] },
			});
		});

		return runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result).toMatchObject({
					properties: {
						images: [
							{
								type: "remote",
								url: "https://image.tmdb.org/t/p/original/main.jpg",
								purpose: "profile",
							},
							{
								type: "remote",
								url: "https://image.tmdb.org/t/p/original/alt.jpg",
								purpose: "profile",
							},
						],
					},
				});
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-movie",
						entities: [
							{
								name: "Film",
								externalId: "2",
								providerSlug: "movie.tmdb",
								relationshipProperties: { roles: ["Actor"] },
							},
						],
					},
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-show",
						entities: [
							{
								name: "Show",
								externalId: "3",
								providerSlug: "show.tmdb",
								relationshipProperties: { roles: ["Director"] },
							},
						],
					},
				]);
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("classifies localized profile images", () => {
		const host = makeHost((_method, url) =>
			url.includes("/translations")
				? httpSuccess({ translations: [{ iso_639_1: "fr", data: { name: "Créateur" } }] })
				: httpSuccess({ profiles: [{ iso_639_1: "fr", file_path: "/localized.jpg" }] }),
		);

		return Effect.runPromise(
			runSandboxTestScript(
				translate,
				{ externalId: "1", language: "fr", entitySchemaSlug: "person" },
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result.properties).toEqual({
						images: [
							{
								type: "remote",
								url: "https://image.tmdb.org/t/p/original/localized.jpg",
								purpose: "profile",
							},
						],
					});
					return undefined;
				}),
			),
		);
	});
});
