import { assert, describe, expect, it } from "vitest";

import {
	podcastEpisodePropertiesSchema,
	showEpisodePropertiesSchema,
	showSeasonPropertiesSchema,
} from "./media-property-schemas";
import { builtinEventSchemaTriggerLinks, builtinSandboxScripts } from "./registry";

describe("builtinSandboxScripts", () => {
	it("uses generated format-1 representations for the complete TMDB family", () => {
		const scripts = builtinSandboxScripts().filter(
			({ metadata }) =>
				"providerInformation" in metadata && metadata.providerInformation?.source === "tmdb",
		);

		expect(scripts.map(({ slug }) => slug).sort()).toEqual([
			"company.tmdb",
			"movie-group.tmdb",
			"movie.tmdb",
			"person.tmdb",
			"show.tmdb",
		]);
		for (const script of scripts) {
			assert("compiledCode" in script && "manifest" in script);
			expect(script.compiledFormat).toBe(1);
			expect(script.code).toBe(script.source);
			expect(script.metadata).toBe(script.manifest);
			expect(script.source).toContain("defineProvider");
			expect(script.compiledCode).toContain("ryot:sandbox-script");
			expect(script.compiledCode).toContain("sourceMappingURL=data:application/json;base64,");
		}
	});

	it("uses generated format-1 representations for the complete TVDB family", () => {
		const scripts = builtinSandboxScripts().filter(
			({ metadata }) =>
				"providerInformation" in metadata && metadata.providerInformation?.source === "tvdb",
		);

		expect(scripts.map(({ slug }) => slug).sort()).toEqual([
			"company.tvdb",
			"movie-group.tvdb",
			"movie.tvdb",
			"person.tvdb",
			"show.tvdb",
		]);
		for (const script of scripts) {
			assert("compiledCode" in script && "manifest" in script);
			expect(script.compiledFormat).toBe(1);
			expect(script.code).toBe(script.source);
			expect(script.metadata).toBe(script.manifest);
			expect(script.source).toContain("defineProvider");
			expect(script.compiledCode).toContain("ryot:sandbox-script");
			expect(script.compiledCode).toContain("sourceMappingURL=data:application/json;base64,");
		}
	});

	it("uses generated format-1 representations for the anime and manga provider families", () => {
		const sources = new Set(["anilist", "myanimelist", "manga-updates"]);
		const scripts = builtinSandboxScripts().filter(
			({ metadata }) =>
				"providerInformation" in metadata &&
				sources.has(metadata.providerInformation?.source ?? ""),
		);

		expect(scripts.map(({ slug }) => slug).sort()).toEqual([
			"anime.anilist",
			"anime.myanimelist",
			"company.anilist",
			"manga.anilist",
			"manga.manga-updates",
			"manga.myanimelist",
			"person.anilist",
			"person.manga-updates",
		]);
		for (const script of scripts) {
			assert("compiledCode" in script && "manifest" in script);
			expect(script.compiledFormat).toBe(1);
			expect(script.code).toBe(script.source);
			expect(script.metadata).toBe(script.manifest);
			expect(script.source).toContain("defineProvider");
			expect(script.compiledCode).toContain("ryot:sandbox-script");
			expect(script.compiledCode).toContain("sourceMappingURL=data:application/json;base64,");
		}
	});

	it("uses generated format-1 representations and manifest modes for every trigger", () => {
		const triggers = builtinSandboxScripts().filter(({ slug }) => slug.startsWith("trigger."));
		const links = new Map(
			builtinEventSchemaTriggerLinks().map((link) => [link.scriptSlug, link.phase]),
		);

		expect(triggers.map(({ slug }) => slug).sort()).toEqual([
			"trigger.auto-complete-on-full-progress",
			"trigger.integration-progress-policy",
			"trigger.jellyfin-push",
			"trigger.radarr-push",
			"trigger.sonarr-push",
		]);
		for (const trigger of triggers) {
			assert("compiledCode" in trigger && "manifest" in trigger);
			expect(trigger.compiledFormat).toBe(1);
			expect(trigger.code).toBe(trigger.source);
			expect(trigger.metadata).toBe(trigger.manifest);
			expect(trigger.manifest.kind).toBe("trigger");
			expect(trigger.source).toMatch(/define(?:Before|After)CreateTrigger/);
			expect(trigger.compiledCode).toContain("ryot:sandbox-script");
			if (trigger.manifest.kind === "trigger") {
				expect(links.get(trigger.slug)).toBe(trigger.manifest.mode);
			}
		}

		const policy = triggers.find(({ slug }) => slug === "trigger.integration-progress-policy");
		assert(policy && "manifest" in policy);
		expect(policy.manifest.requiredAppConfigKeys).toEqual([
			"scheduler.progressUpdateThresholdHours",
		]);
	});

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
		expect(showSeasonPropertiesSchema.fields["parentShowExternalId"]).toMatchObject({
			type: "string",
		});
		expect(showEpisodePropertiesSchema.fields["parentShowExternalId"]).toMatchObject({
			type: "string",
		});
	});

	it("keeps parent podcast external ids on podcast episode property schemas", () => {
		expect(podcastEpisodePropertiesSchema.fields["parentPodcastExternalId"]).toMatchObject({
			type: "string",
		});
	});
});
