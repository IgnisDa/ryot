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
		const providerInformationBySlug = new Map(
			scripts.map((script) => [
				script.slug,
				"providerInformation" in script.metadata ? script.metadata.providerInformation : undefined,
			]),
		);
		const translatedScripts = [
			["anime.anilist", "anilist", "en"],
			["manga.anilist", "anilist", "en"],
			["podcast.itunes", "itunes", "en"],
			["movie.tmdb", "tmdb", "en"],
			["show.tmdb", "tmdb", "en"],
			["person.tmdb", "tmdb", "en"],
			["movie-group.tmdb", "tmdb", "en"],
			["movie.tvdb", "tvdb", "en"],
			["show.tvdb", "tvdb", "en"],
			["person.tvdb", "tvdb", "en"],
			["movie-group.tvdb", "tvdb", "en"],
			["music.youtube-music", "youtube-music", "en"],
			["person.youtube-music", "youtube-music", "en"],
			["music-group.youtube-music", "youtube-music", "en"],
		] as const;

		for (const [slug, source, canonicalLanguage] of translatedScripts) {
			expect(providerInformationBySlug.get(slug)).toEqual({ source, canonicalLanguage });
		}
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
