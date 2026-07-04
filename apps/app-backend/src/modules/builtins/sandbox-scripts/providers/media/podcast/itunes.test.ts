import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search, translate } from "./itunes.sandbox";

type ItunesHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: ItunesHost["httpCall"]) =>
	defineSandboxTestHost(manifest, { httpCall });

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("podcast.itunes sandbox script", () => {
	it("maps search hits, drops entries missing id or title and paginates", () => {
		const host = makeHost(() =>
			httpSuccess({
				results: [
					{
						collectionId: 111,
						collectionName: "First Show",
						releaseDate: "2021-06-01T00:00:00Z",
						artworkUrl600: "https://img/600.jpg",
					},
					{ collectionId: 222, collectionName: "" },
				],
			}),
		);

		return runSandboxTestDriver(
			search,
			{ query: "tech", page: 1, pageSize: 1 },
			host,
			execution,
		).then((result) => {
			expect(result.items).toEqual([
				{
					externalId: "111",
					calloutProperty: { kind: "null", value: null },
					titleProperty: { kind: "text", value: "First Show" },
					primarySubtitleProperty: { kind: "number", value: 2021 },
					secondarySubtitleProperty: { kind: "null", value: null },
					imageProperty: { kind: "image", value: { type: "remote", url: "https://img/600.jpg" } },
				},
			]);
			expect(result.details).toEqual({ totalItems: 2, nextPage: 2 });
			return undefined;
		});
	});

	it("numbers episodes by ascending publish date and converts runtime to minutes", () => {
		const host = makeHost((_method, requestUrl) => {
			if (requestUrl.includes("entity=podcastEpisode")) {
				return httpSuccess({
					results: [
						{
							trackId: 20,
							trackName: "Later Episode",
							releaseDate: "2020-01-02T00:00:00Z",
							trackTimeMillis: 1_800_000,
							artworkUrl600: "https://img/ep20.jpg",
						},
						{
							trackId: 10,
							trackName: "Earlier Episode",
							releaseDate: "2020-01-01T00:00:00Z",
							trackTimeMillis: 600_000,
						},
					],
				});
			}
			return httpSuccess({
				results: [
					{
						trackCount: 2,
						artistName: "Some Artist",
						collectionName: "The Podcast",
						description: "A show.",
						releaseDate: "2020-01-01T00:00:00Z",
						genres: ["Technology", { name: "News" }],
						artworkUrl600: "https://img/cover.jpg",
					},
				],
			});
		});

		return runSandboxTestDriver(details, { externalId: "p1" }, host, execution).then((result) => {
			expect(result.name).toBe("The Podcast");
			expect(result.childEntities).toEqual([
				{
					entitySchemaSlug: "podcast-episode",
					externalId: "10",
					name: "Earlier Episode",
					properties: {
						runtime: 10,
						episodeNumber: 1,
						description: null,
						publishDate: "2020-01-01",
						parentPodcastExternalId: "p1",
					},
				},
				{
					entitySchemaSlug: "podcast-episode",
					externalId: "20",
					name: "Later Episode",
					properties: {
						runtime: 30,
						episodeNumber: 2,
						description: null,
						publishDate: "2020-01-02",
						parentPodcastExternalId: "p1",
						images: [{ type: "remote", url: "https://img/ep20.jpg" }],
					},
				},
			]);
			expect(result.properties).toMatchObject({
				publishYear: 2020,
				totalEpisodes: 2,
				genres: ["Technology", "News"],
				unlinkedCreators: [{ role: "Artist", name: "Some Artist" }],
				sourceUrl: "https://podcasts.apple.com/us/podcast/the-podcast/idp1",
			});
			return undefined;
		});
	});

	it("translates a podcast entity from the collection payload", () => {
		const host = makeHost(() =>
			httpSuccess({
				results: [{ collectionName: "Traducido", description: "Descripción" }],
			}),
		);

		return runSandboxTestDriver(
			translate,
			{ externalId: "p1", language: "es-ES", entitySchemaSlug: "podcast" },
			host,
			execution,
		).then((result) => {
			expect(result).toEqual({ name: "Traducido", properties: { description: "Descripción" } });
			return undefined;
		});
	});

	it("translates a podcast episode by locating it in the parent lookup", () => {
		const host = makeHost(() =>
			httpSuccess({
				results: [
					{ collectionName: "Parent" },
					{ trackId: 55, trackName: "Episode Title", description: "Episode overview" },
				],
			}),
		);

		return runSandboxTestDriver(
			translate,
			{
				externalId: "55",
				language: "fr-FR",
				entitySchemaSlug: "podcast-episode",
				properties: { parentPodcastExternalId: "p1" },
			},
			host,
			execution,
		).then((result) => {
			expect(result).toEqual({
				name: "Episode Title",
				properties: { description: "Episode overview" },
			});
			return undefined;
		});
	});
});
