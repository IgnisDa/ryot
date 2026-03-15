import {
	type GeneratedBuiltinSandboxScript,
	sandboxAutomationDotMediaDashEntityDashUpdatedScript,
	sandboxAutomationDotMediaDashRelationshipDashSyncScript,
	sandboxAutomationDotNotificationScript,
	sandboxAutomationDotReviewDashCreatedScript,
	sandboxAutomationDotTestDashPolicyScript,
	sandboxAutomationDotTestDashNotifierScript,
	sandboxAutomationDotTestDashTracerScript,
	sandboxAutomationDotWorkoutDashCreatedScript,
	sandboxComicDashBookDashGroupDotMetronScript,
	sandboxComicDashBookDotMetronScript,
	sandboxCompanyDotVndbScript,
	sandboxExerciseDotFreeDashExerciseDashDbScript,
	sandboxPersonDotMetronScript,
	sandboxVisualDashNovelDotVndbScript,
	sandboxCompanyDotGiantDashBombScript,
	sandboxCompanyDotIgdbScript,
	sandboxPersonDotGiantDashBombScript,
	sandboxVideoDashGameDashGroupDotGiantDashBombScript,
	sandboxVideoDashGameDashGroupDotIgdbScript,
	sandboxVideoDashGameDotGiantDashBombScript,
	sandboxVideoDashGameDotIgdbScript,
	sandboxAnimeDotAnilistScript,
	sandboxAnimeDotMyanimelistScript,
	sandboxAudiobookDashGroupDotAudibleScript,
	sandboxAudiobookDotAudibleScript,
	sandboxBookDashGroupDotHardcoverScript,
	sandboxBookDotGoogleDashBooksScript,
	sandboxBookDotHardcoverScript,
	sandboxBookDotOpenlibraryScript,
	sandboxCompanyDotAnilistScript,
	sandboxCompanyDotHardcoverScript,
	sandboxCompanyDotTmdbScript,
	sandboxCompanyDotTvdbScript,
	sandboxMangaDotAnilistScript,
	sandboxMangaDotMangaDashUpdatesScript,
	sandboxMangaDotMyanimelistScript,
	sandboxMovieDashGroupDotTmdbScript,
	sandboxMovieDashGroupDotTvdbScript,
	sandboxMovieDotTmdbScript,
	sandboxMovieDotTvdbScript,
	sandboxMusicDashGroupDotMusicDashBrainzScript,
	sandboxMusicDashGroupDotSpotifyScript,
	sandboxMusicDashGroupDotYoutubeDashMusicScript,
	sandboxMusicDotMusicDashBrainzScript,
	sandboxMusicDotSpotifyScript,
	sandboxMusicDotYoutubeDashMusicScript,
	sandboxPersonDotAnilistScript,
	sandboxPersonDotMusicDashBrainzScript,
	sandboxPersonDotSpotifyScript,
	sandboxPersonDotYoutubeDashMusicScript,
	sandboxPersonDotAudibleScript,
	sandboxPersonDotHardcoverScript,
	sandboxPersonDotMangaDashUpdatesScript,
	sandboxPersonDotOpenlibraryScript,
	sandboxPersonDotTmdbScript,
	sandboxPersonDotTvdbScript,
	sandboxPodcastDotItunesScript,
	sandboxPodcastDotListennotesScript,
	sandboxShowDotTmdbScript,
	sandboxShowDotTvdbScript,
	sandboxTriggerDotAutoDashCompleteDashOnDashFullDashProgressScript,
	sandboxTriggerDotIntegrationDashProgressDashPolicyScript,
	sandboxTriggerDotJellyfinDashPushScript,
	sandboxTriggerDotRadarrDashPushScript,
	sandboxTriggerDotSonarrDashPushScript,
} from "./generated-sandbox/registry";
import { builtinMediaEntitySchemaSlugs } from "./media-schema-slugs";

const mediaUpdateEntitySchemaSlugs = [
	...builtinMediaEntitySchemaSlugs,
	"show-episode",
	"podcast-episode",
].filter((slug, index, slugs) => slug !== "show-season" && slugs.indexOf(slug) === index);

export const builtinSandboxScripts = () => [
	sandboxAutomationDotNotificationScript,
	sandboxAutomationDotMediaDashEntityDashUpdatedScript,
	sandboxAutomationDotMediaDashRelationshipDashSyncScript,
	sandboxAutomationDotReviewDashCreatedScript,
	sandboxAutomationDotTestDashPolicyScript,
	sandboxAutomationDotTestDashNotifierScript,
	sandboxAutomationDotTestDashTracerScript,
	sandboxAutomationDotWorkoutDashCreatedScript,
	sandboxExerciseDotFreeDashExerciseDashDbScript,
	sandboxBookDotOpenlibraryScript,
	sandboxAudiobookDotAudibleScript,
	sandboxPodcastDotItunesScript,
	sandboxVisualDashNovelDotVndbScript,
	sandboxAnimeDotAnilistScript,
	sandboxMangaDotAnilistScript,
	sandboxCompanyDotAnilistScript,
	sandboxCompanyDotGiantDashBombScript,
	sandboxCompanyDotHardcoverScript,
	sandboxCompanyDotIgdbScript,
	sandboxCompanyDotTmdbScript,
	sandboxCompanyDotTvdbScript,
	sandboxCompanyDotVndbScript,
	sandboxPersonDotAnilistScript,
	sandboxPersonDotAudibleScript,
	sandboxPersonDotGiantDashBombScript,
	sandboxPersonDotMangaDashUpdatesScript,
	sandboxMangaDotMangaDashUpdatesScript,
	sandboxMusicDotMusicDashBrainzScript,
	sandboxPersonDotMusicDashBrainzScript,
	sandboxPersonDotOpenlibraryScript,
	sandboxMusicDotYoutubeDashMusicScript,
	sandboxPersonDotYoutubeDashMusicScript,
	sandboxBookDotHardcoverScript,
	sandboxPersonDotHardcoverScript,
	sandboxBookDotGoogleDashBooksScript,
	sandboxPodcastDotListennotesScript,
	sandboxVideoDashGameDotGiantDashBombScript,
	sandboxMovieDotTmdbScript,
	sandboxShowDotTmdbScript,
	sandboxPersonDotTmdbScript,
	sandboxMovieDotTvdbScript,
	sandboxShowDotTvdbScript,
	sandboxPersonDotTvdbScript,
	sandboxAnimeDotMyanimelistScript,
	sandboxMangaDotMyanimelistScript,
	sandboxComicDashBookDotMetronScript,
	sandboxPersonDotMetronScript,
	sandboxMusicDotSpotifyScript,
	sandboxPersonDotSpotifyScript,
	sandboxVideoDashGameDotIgdbScript,
	sandboxMovieDashGroupDotTmdbScript,
	sandboxMovieDashGroupDotTvdbScript,
	sandboxAudiobookDashGroupDotAudibleScript,
	sandboxBookDashGroupDotHardcoverScript,
	sandboxComicDashBookDashGroupDotMetronScript,
	sandboxMusicDashGroupDotSpotifyScript,
	sandboxMusicDashGroupDotMusicDashBrainzScript,
	sandboxMusicDashGroupDotYoutubeDashMusicScript,
	sandboxVideoDashGameDashGroupDotIgdbScript,
	sandboxVideoDashGameDashGroupDotGiantDashBombScript,
	sandboxTriggerDotAutoDashCompleteDashOnDashFullDashProgressScript,
	sandboxTriggerDotIntegrationDashProgressDashPolicyScript,
	sandboxTriggerDotRadarrDashPushScript,
	sandboxTriggerDotSonarrDashPushScript,
	sandboxTriggerDotJellyfinDashPushScript,
];

export const builtinSignalAutomationRuleLinks = () => [
	{
		name: "Automation Test Tracer",
		signalSchemaSlug: "automation.test-tracer",
		scriptSlug: sandboxAutomationDotTestDashTracerScript.slug,
	},
];

export const builtinEntityAutomationRuleLinks = () => [
	{
		entitySchemaSlug: "workout",
		operation: "create" as const,
		name: sandboxAutomationDotWorkoutDashCreatedScript.name,
		scriptSlug: sandboxAutomationDotWorkoutDashCreatedScript.slug,
	},
	...mediaUpdateEntitySchemaSlugs.map((entitySchemaSlug) => ({
		entitySchemaSlug,
		operation: "update" as const,
		name: sandboxAutomationDotMediaDashEntityDashUpdatedScript.name,
		scriptSlug: sandboxAutomationDotMediaDashEntityDashUpdatedScript.slug,
	})),
];

export const builtinRelationshipAutomationRuleLinks = () =>
	["show-to-show-season", "show-season-to-show-episode", "podcast-to-podcast-episode"].flatMap(
		(relationshipSchemaSlug) =>
			(["create", "update", "delete"] as const).map((operation) => ({
				operation,
				relationshipSchemaSlug,
				name: sandboxAutomationDotMediaDashRelationshipDashSyncScript.name,
				scriptSlug: sandboxAutomationDotMediaDashRelationshipDashSyncScript.slug,
			})),
	);

export const entitySchemaSandboxScriptLinks = () =>
	[
		{ schemaSlug: "show", scriptSlug: "show.tmdb" },
		{ schemaSlug: "show", scriptSlug: "show.tvdb" },
		{ schemaSlug: "movie", scriptSlug: "movie.tvdb" },
		{ schemaSlug: "movie", scriptSlug: "movie.tmdb" },
		{ schemaSlug: "music", scriptSlug: "music.spotify" },
		{ schemaSlug: "manga", scriptSlug: "manga.anilist" },
		{ schemaSlug: "anime", scriptSlug: "anime.anilist" },
		{ schemaSlug: "book", scriptSlug: "book.hardcover" },
		{ schemaSlug: "book", scriptSlug: "book.openlibrary" },
		{ schemaSlug: "book", scriptSlug: "book.google-books" },
		{ schemaSlug: "podcast", scriptSlug: "podcast.itunes" },
		{ schemaSlug: "music", scriptSlug: "music.music-brainz" },
		{ schemaSlug: "anime", scriptSlug: "anime.myanimelist" },
		{ schemaSlug: "manga", scriptSlug: "manga.myanimelist" },
		{ schemaSlug: "manga", scriptSlug: "manga.manga-updates" },
		{ schemaSlug: "music", scriptSlug: "music.youtube-music" },
		{ schemaSlug: "video-game", scriptSlug: "video-game.igdb" },
		{ schemaSlug: "audiobook", scriptSlug: "audiobook.audible" },
		{ schemaSlug: "podcast", scriptSlug: "podcast.listennotes" },
		{ schemaSlug: "comic-book", scriptSlug: "comic-book.metron" },
		{ schemaSlug: "visual-novel", scriptSlug: "visual-novel.vndb" },
		{ schemaSlug: "video-game", scriptSlug: "video-game.giant-bomb" },
	] as const;

export const fitnessSchemaSandboxScriptLinks = () =>
	[{ schemaSlug: "exercise", scriptSlug: "exercise.free-exercise-db" }] as const;

const eventAutomationLink = (
	entry: GeneratedBuiltinSandboxScript,
	input: {
		readonly position?: number;
		readonly eventSchemaSlug: string;
		readonly kind: "policy" | "subscription";
		readonly metadata?: { readonly inheritedProperties?: readonly string[] };
	},
) => {
	if (entry.manifest.kind !== "automation") {
		throw new Error(
			`Built-in event automation link requires an automation manifest: ${entry.slug}`,
		);
	}
	return { ...input, name: entry.name, scriptSlug: entry.slug };
};

export const builtinEventAutomationRuleLinks = () => [
	eventAutomationLink(sandboxAutomationDotReviewDashCreatedScript, {
		kind: "subscription",
		eventSchemaSlug: "review",
	}),
	eventAutomationLink(sandboxTriggerDotAutoDashCompleteDashOnDashFullDashProgressScript, {
		kind: "subscription",
		eventSchemaSlug: "progress",
		metadata: { inheritedProperties: ["consumedOn"] },
	}),
	eventAutomationLink(sandboxTriggerDotIntegrationDashProgressDashPolicyScript, {
		position: 100,
		kind: "policy",
		eventSchemaSlug: "progress",
	}),
	eventAutomationLink(sandboxTriggerDotRadarrDashPushScript, {
		kind: "subscription",
		eventSchemaSlug: "add-entity-to-collection",
	}),
	eventAutomationLink(sandboxTriggerDotSonarrDashPushScript, {
		kind: "subscription",
		eventSchemaSlug: "add-entity-to-collection",
	}),
	eventAutomationLink(sandboxTriggerDotJellyfinDashPushScript, {
		kind: "subscription",
		eventSchemaSlug: "complete",
	}),
];

export const personSchemaSandboxScriptLinks = () =>
	[
		{ schemaSlug: "person", scriptSlug: "person.tmdb" },
		{ schemaSlug: "person", scriptSlug: "person.tvdb" },
		{ schemaSlug: "person", scriptSlug: "person.metron" },
		{ schemaSlug: "person", scriptSlug: "person.anilist" },
		{ schemaSlug: "person", scriptSlug: "person.audible" },
		{ schemaSlug: "person", scriptSlug: "person.spotify" },
		{ schemaSlug: "person", scriptSlug: "person.hardcover" },
		{ schemaSlug: "person", scriptSlug: "person.music-brainz" },
		{ schemaSlug: "person", scriptSlug: "person.openlibrary" },
		{ schemaSlug: "person", scriptSlug: "person.youtube-music" },
		{ schemaSlug: "person", scriptSlug: "person.giant-bomb" },
		{ schemaSlug: "person", scriptSlug: "person.manga-updates" },
	] as const;

export const companySchemaSandboxScriptLinks = () =>
	[
		{ schemaSlug: "company", scriptSlug: "company.igdb" },
		{ schemaSlug: "company", scriptSlug: "company.tmdb" },
		{ schemaSlug: "company", scriptSlug: "company.tvdb" },
		{ schemaSlug: "company", scriptSlug: "company.vndb" },
		{ schemaSlug: "company", scriptSlug: "company.anilist" },
		{ schemaSlug: "company", scriptSlug: "company.hardcover" },
		{ schemaSlug: "company", scriptSlug: "company.giant-bomb" },
	] as const;

export const groupSchemaSandboxScriptLinks = () =>
	[
		{ schemaSlug: "movie-group", scriptSlug: "movie-group.tmdb" },
		{ schemaSlug: "movie-group", scriptSlug: "movie-group.tvdb" },
		{ schemaSlug: "book-group", scriptSlug: "book-group.hardcover" },
		{ schemaSlug: "music-group", scriptSlug: "music-group.spotify" },
		{ schemaSlug: "music-group", scriptSlug: "music-group.music-brainz" },
		{ schemaSlug: "music-group", scriptSlug: "music-group.youtube-music" },
		{ schemaSlug: "video-game-group", scriptSlug: "video-game-group.igdb" },
		{ schemaSlug: "audiobook-group", scriptSlug: "audiobook-group.audible" },
		{ schemaSlug: "comic-book-group", scriptSlug: "comic-book-group.metron" },
		{ schemaSlug: "video-game-group", scriptSlug: "video-game-group.giant-bomb" },
	] as const;
