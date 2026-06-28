import { assert, describe, expect, it } from "vitest";

import {
	podcastEpisodePropertiesSchema,
	showEpisodePropertiesSchema,
	showSeasonPropertiesSchema,
} from "./media-property-schemas";
import {
	builtinEventAutomationRuleLinks,
	builtinEntityAutomationRuleLinks,
	builtinSandboxScripts,
	builtinSignalAutomationRuleLinks,
} from "./registry";

describe("builtinSandboxScripts", () => {
	it("uses generated format-1 representations for the complete TMDB family", () => {
		const scripts = builtinSandboxScripts().filter(
			({ manifest }) =>
				"providerInformation" in manifest && manifest.providerInformation.source === "tmdb",
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
			expect(script.source).toContain("defineProvider");
			expect(script.compiledCode).toContain("ryot:sandbox-script");
			expect(script.compiledCode).toContain("sourceMappingURL=data:application/json;base64,");
		}
	});

	it("uses generated format-1 representations for the complete TVDB family", () => {
		const scripts = builtinSandboxScripts().filter(
			({ manifest }) =>
				"providerInformation" in manifest && manifest.providerInformation.source === "tvdb",
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
			expect(script.source).toContain("defineProvider");
			expect(script.compiledCode).toContain("ryot:sandbox-script");
			expect(script.compiledCode).toContain("sourceMappingURL=data:application/json;base64,");
		}
	});

	it("uses generated format-1 representations for the anime and manga provider families", () => {
		const sources = new Set(["anilist", "myanimelist", "manga-updates"]);
		const scripts = builtinSandboxScripts().filter(
			({ manifest }) =>
				"providerInformation" in manifest && sources.has(manifest.providerInformation.source),
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
			expect(script.source).toContain("defineProvider");
			expect(script.compiledCode).toContain("ryot:sandbox-script");
			expect(script.compiledCode).toContain("sourceMappingURL=data:application/json;base64,");
		}
	});

	it("uses generated format-1 representations for the book provider families", () => {
		const sources = new Set(["hardcover", "openlibrary", "google-books"]);
		const scripts = builtinSandboxScripts().filter(
			({ manifest }) =>
				"providerInformation" in manifest && sources.has(manifest.providerInformation.source),
		);

		expect(scripts.map(({ slug }) => slug).sort()).toEqual([
			"book-group.hardcover",
			"book.google-books",
			"book.hardcover",
			"book.openlibrary",
			"company.hardcover",
			"person.hardcover",
			"person.openlibrary",
		]);
		for (const script of scripts) {
			assert("compiledCode" in script && "manifest" in script);
			expect(script.compiledFormat).toBe(1);
			expect(script.source).toContain("defineProvider");
			expect(script.compiledCode).toContain("ryot:sandbox-script");
			expect(script.compiledCode).toContain("sourceMappingURL=data:application/json;base64,");
		}
	});

	it("uses generated format-1 representations for the audiobook and podcast provider families", () => {
		const sources = new Set(["audible", "itunes", "listennotes"]);
		const scripts = builtinSandboxScripts().filter(
			({ manifest }) =>
				"providerInformation" in manifest && sources.has(manifest.providerInformation.source),
		);

		expect(scripts.map(({ slug }) => slug).sort()).toEqual([
			"audiobook-group.audible",
			"audiobook.audible",
			"person.audible",
			"podcast.itunes",
			"podcast.listennotes",
		]);
		for (const script of scripts) {
			assert("compiledCode" in script && "manifest" in script);
			expect(script.compiledFormat).toBe(1);
			expect(script.source).toContain("defineProvider");
			expect(script.compiledCode).toContain("ryot:sandbox-script");
			expect(script.compiledCode).toContain("sourceMappingURL=data:application/json;base64,");
		}
	});

	it("uses generated format-1 representations for the music provider families", () => {
		const sources = new Set(["music-brainz", "spotify", "youtube-music"]);
		const scripts = builtinSandboxScripts().filter(
			({ manifest }) =>
				"providerInformation" in manifest && sources.has(manifest.providerInformation.source),
		);

		expect(scripts.map(({ slug }) => slug).sort()).toEqual([
			"music-group.music-brainz",
			"music-group.spotify",
			"music-group.youtube-music",
			"music.music-brainz",
			"music.spotify",
			"music.youtube-music",
			"person.music-brainz",
			"person.spotify",
			"person.youtube-music",
		]);
		for (const script of scripts) {
			assert("compiledCode" in script && "manifest" in script);
			expect(script.compiledFormat).toBe(1);
			expect(script.source).toContain("defineProvider");
			expect(script.compiledCode).toContain("ryot:sandbox-script");
			expect(script.compiledCode).toContain("sourceMappingURL=data:application/json;base64,");
		}
	});

	it("uses generated format-1 representations for the GiantBomb and IGDB game provider families", () => {
		const sources = new Set(["giant-bomb", "igdb"]);
		const scripts = builtinSandboxScripts().filter(
			({ manifest }) =>
				"providerInformation" in manifest && sources.has(manifest.providerInformation.source),
		);

		expect(scripts.map(({ slug }) => slug).sort()).toEqual([
			"company.giant-bomb",
			"company.igdb",
			"person.giant-bomb",
			"video-game-group.giant-bomb",
			"video-game-group.igdb",
			"video-game.giant-bomb",
			"video-game.igdb",
		]);
		for (const script of scripts) {
			assert("compiledCode" in script && "manifest" in script);
			expect(script.compiledFormat).toBe(1);
			expect(script.source).toContain("defineProvider");
			expect(script.compiledCode).toContain("ryot:sandbox-script");
			expect(script.compiledCode).toContain("sourceMappingURL=data:application/json;base64,");
		}
	});

	it("uses generated format-1 representations for the comic, visual-novel, and fitness families", () => {
		const sources = new Set(["metron", "vndb", "free-exercise-db"]);
		const scripts = builtinSandboxScripts().filter(
			({ manifest }) =>
				"providerInformation" in manifest && sources.has(manifest.providerInformation.source),
		);

		expect(scripts.map(({ slug }) => slug).sort()).toEqual([
			"comic-book-group.metron",
			"comic-book.metron",
			"company.vndb",
			"exercise.free-exercise-db",
			"person.metron",
			"visual-novel.vndb",
		]);
		for (const script of scripts) {
			assert("compiledCode" in script && "manifest" in script);
			expect(script.compiledFormat).toBe(1);
			expect(script.source).toContain("defineProvider");
			expect(script.compiledCode).toContain("ryot:sandbox-script");
			expect(script.compiledCode).toContain("sourceMappingURL=data:application/json;base64,");
		}
	});

	it("registers migrated event scripts as automation rules", () => {
		const automations = builtinSandboxScripts().filter(({ slug }) => slug.startsWith("trigger."));
		const links = builtinEventAutomationRuleLinks().filter(({ scriptSlug }) =>
			scriptSlug.startsWith("trigger."),
		);

		expect(automations.map(({ slug }) => slug).sort()).toEqual([
			"trigger.auto-complete-on-full-progress",
			"trigger.integration-progress-policy",
			"trigger.jellyfin-push",
			"trigger.radarr-push",
			"trigger.sonarr-push",
		]);
		for (const automation of automations) {
			assert("compiledCode" in automation && "manifest" in automation);
			expect(automation.compiledFormat).toBe(1);
			expect(automation.manifest.kind).toBe("automation");
			expect(automation.source).toMatch(/defineAutomation(?:Policy)?/);
			expect(automation.compiledCode).toContain("ryot:sandbox-script");
			expect(links.some(({ scriptSlug }) => scriptSlug === automation.slug)).toBe(true);
		}

		expect(links).toEqual([
			{
				kind: "subscription",
				eventSchemaSlug: "progress",
				name: "Auto-Complete on Full Progress",
				metadata: { inheritedProperties: ["consumedOn"] },
				scriptSlug: "trigger.auto-complete-on-full-progress",
			},
			{
				position: 100,
				kind: "policy",
				eventSchemaSlug: "progress",
				name: "Integration Progress Policy",
				scriptSlug: "trigger.integration-progress-policy",
			},
			{
				name: "Radarr Push",
				kind: "subscription",
				scriptSlug: "trigger.radarr-push",
				eventSchemaSlug: "add-entity-to-collection",
			},
			{
				name: "Sonarr Push",
				kind: "subscription",
				scriptSlug: "trigger.sonarr-push",
				eventSchemaSlug: "add-entity-to-collection",
			},
			{
				kind: "subscription",
				name: "Jellyfin Push",
				eventSchemaSlug: "complete",
				scriptSlug: "trigger.jellyfin-push",
			},
		]);

		const policy = automations.find(({ slug }) => slug === "trigger.integration-progress-policy");
		assert(policy && "manifest" in policy);
		expect(policy.manifest.requiredAppConfigKeys).toEqual([
			"scheduler.progressUpdateThresholdHours",
		]);
	});

	it("registers exactly one lifecycle producer for review and workout signals", () => {
		const reviewLinks = builtinEventAutomationRuleLinks().filter(
			({ scriptSlug }) => scriptSlug === "automation.review-created",
		);
		const workoutLinks = builtinEntityAutomationRuleLinks().filter(
			({ scriptSlug }) => scriptSlug === "automation.workout-created",
		);

		expect(reviewLinks).toEqual([
			{
				kind: "subscription",
				eventSchemaSlug: "review",
				name: "Review Created Detector",
				scriptSlug: "automation.review-created",
			},
		]);
		expect(workoutLinks).toEqual([
			{
				operation: "create",
				entitySchemaSlug: "workout",
				name: "Workout Created Detector",
				scriptSlug: "automation.workout-created",
			},
		]);
		expect(
			builtinEntityAutomationRuleLinks().filter(
				({ scriptSlug }) => scriptSlug === "automation.review-created",
			),
		).toEqual([]);
		expect(
			builtinEventAutomationRuleLinks().filter(
				({ scriptSlug }) => scriptSlug === "automation.workout-created",
			),
		).toEqual([]);
	});

	it("registers the media update detector only for update occurrences", () => {
		const links = builtinEntityAutomationRuleLinks().filter(
			({ scriptSlug }) => scriptSlug === "automation.media-entity-updated",
		);
		const detector = builtinSandboxScripts().find(
			({ slug }) => slug === "automation.media-entity-updated",
		);

		assert(detector);
		expect(detector.manifest.capabilities).toEqual(["emitSignal"]);
		expect(links).not.toHaveLength(0);
		expect(links.every(({ operation }) => operation === "update")).toBe(true);
		expect(links.some(({ entitySchemaSlug }) => entitySchemaSlug === "show-episode")).toBe(true);
		expect(links.some(({ entitySchemaSlug }) => entitySchemaSlug === "show-season")).toBe(false);
	});

	it("registers the shared notification script with only send-notification authority", () => {
		const notifier = builtinSandboxScripts().find(({ slug }) => slug === "automation.notification");
		assert(notifier);
		expect(notifier.manifest.kind).toBe("automation");
		expect(notifier.manifest.capabilities).toEqual(["sendNotification"]);
		expect(notifier.compiledCode).toContain("ryot:sandbox-script");
	});

	it("registers automation test scripts with isolated capabilities", () => {
		const policy = builtinSandboxScripts().find(({ slug }) => slug === "automation.test-policy");
		const automation = builtinSandboxScripts().find(
			({ slug }) => slug === "automation.test-tracer",
		);
		const notifier = builtinSandboxScripts().find(
			({ slug }) => slug === "automation.test-notifier",
		);
		assert(policy);
		assert(automation);
		assert(notifier);
		expect(policy.manifest.kind).toBe("automation");
		expect(automation.manifest.kind).toBe("automation");
		expect(notifier.manifest.kind).toBe("automation");
		expect(policy.manifest.capabilities).toEqual([]);
		expect(automation.manifest.capabilities).toEqual(["emitSignal"]);
		expect(notifier.manifest.capabilities).toEqual(["sendNotification"]);
		expect(policy.compiledCode).toContain("ryot:sandbox-script");
		expect(automation.compiledCode).toContain("ryot:sandbox-script");
		expect(notifier.compiledCode).toContain("ryot:sandbox-script");
		expect(builtinSignalAutomationRuleLinks()).toEqual([
			{
				name: "Automation Test Tracer",
				scriptSlug: "automation.test-tracer",
				signalSchemaSlug: "automation.test-tracer",
			},
		]);
	});

	it("declares source metadata for every provider script", () => {
		const scripts = builtinSandboxScripts();
		const mismatches = scripts
			.filter((script) => script.manifest.kind === "provider")
			.flatMap((script) => {
				const slugParts = script.slug.split(".");
				const expectedSource = slugParts[slugParts.length - 1];
				const actualSource =
					"providerInformation" in script.manifest
						? script.manifest.providerInformation.source
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
				"providerInformation" in script.manifest ? script.manifest.providerInformation : undefined,
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
