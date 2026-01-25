import { describe, expect, it } from "vitest";

import { showEpisodePropertiesSchema, showSeasonPropertiesSchema } from "./media-property-schemas";
import { builtinSandboxScripts } from "./registry";

describe("builtinSandboxScripts", () => {
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
		expect(providerInformationFor("anime.anilist")).toEqual({
			source: "anilist",
			canonicalLanguage: "english",
		});
		expect(providerInformationFor("manga.anilist")).toEqual({
			source: "anilist",
			canonicalLanguage: "english",
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
});
