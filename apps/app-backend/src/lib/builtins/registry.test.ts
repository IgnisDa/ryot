import { describe, expect, it } from "vitest";

import {
	podcastEpisodePropertiesSchema,
	showEpisodePropertiesSchema,
	showSeasonPropertiesSchema,
} from "./media-property-schemas";
import { builtinSandboxScripts } from "./registry";

describe("builtinSandboxScripts", () => {
	it("declares source metadata for every provider script", () => {
		const scripts = builtinSandboxScripts();
		const mismatches = scripts
			.filter((script) => !script.slug.startsWith("trigger."))
			.flatMap((script) => {
				const slugParts = script.slug.split(".");
				const expectedSource = slugParts[slugParts.length - 1];
				const actualSource =
					"providerInformation" in script.metadata
						? script.metadata.providerInformation?.source
						: undefined;
				return actualSource === expectedSource
					? []
					: [`${script.slug}:${actualSource ?? "missing"}`];
			});

		expect(mismatches).toEqual([]);
	});

	it("declares translation metadata for translated scripts", () => {
		const scripts = builtinSandboxScripts();
		const providerInformationFor = (slug: string) => {
			const script = scripts.find((item) => item.slug === slug);
			return script && "providerInformation" in script.metadata
				? script.metadata.providerInformation
				: undefined;
		};

		expect(providerInformationFor("movie.tmdb")).toEqual({
			source: "tmdb",
			canonicalLanguage: "en-US",
		});
		expect(providerInformationFor("person.tmdb")).toEqual({
			source: "tmdb",
			canonicalLanguage: "en-US",
		});
		expect(providerInformationFor("show.tmdb")).toEqual({
			source: "tmdb",
			canonicalLanguage: "en-US",
		});
		expect(providerInformationFor("movie-group.tmdb")).toEqual({
			source: "tmdb",
			canonicalLanguage: "en-US",
		});
		expect(providerInformationFor("movie.tvdb")).toEqual({
			source: "tvdb",
			canonicalLanguage: "eng",
		});
		expect(providerInformationFor("show.tvdb")).toEqual({
			source: "tvdb",
			canonicalLanguage: "eng",
		});
		expect(providerInformationFor("person.tvdb")).toEqual({
			source: "tvdb",
			canonicalLanguage: "eng",
		});
		expect(providerInformationFor("movie-group.tvdb")).toEqual({
			source: "tvdb",
			canonicalLanguage: "eng",
		});
		expect(providerInformationFor("anime.anilist")).toEqual({
			source: "anilist",
			canonicalLanguage: "english",
		});
		expect(providerInformationFor("manga.anilist")).toEqual({
			source: "anilist",
			canonicalLanguage: "english",
		});
		expect(providerInformationFor("podcast.itunes")).toEqual({
			source: "itunes",
			canonicalLanguage: "en_us",
		});
		expect(providerInformationFor("music.youtube-music")).toEqual({
			source: "youtube-music",
			canonicalLanguage: "en",
		});
		expect(providerInformationFor("person.youtube-music")).toEqual({
			source: "youtube-music",
			canonicalLanguage: "en",
		});
		expect(providerInformationFor("music-group.youtube-music")).toEqual({
			source: "youtube-music",
			canonicalLanguage: "en",
		});
	});

	it("keeps parent show external ids on episodic show property schemas", () => {
		expect(showSeasonPropertiesSchema.fields.parentShowExternalId).toMatchObject({
			type: "string",
		});
		expect(showEpisodePropertiesSchema.fields.parentShowExternalId).toMatchObject({
			type: "string",
		});
	});

	it("keeps parent podcast external ids on podcast episode property schemas", () => {
		expect(podcastEpisodePropertiesSchema.fields.parentPodcastExternalId).toMatchObject({
			type: "string",
		});
	});
});
