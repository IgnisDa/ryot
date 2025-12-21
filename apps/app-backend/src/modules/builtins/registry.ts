import {
	type GeneratedBuiltinSandboxScript,
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
import vndbCompanyScriptCode from "./sandbox-scripts/providers/company/vndb.sandbox.js" with { type: "text" };
import freeExerciseDbScriptCode from "./sandbox-scripts/providers/fitness/exercise/free-exercise-db.sandbox.js" with { type: "text" };
import metronComicBookGroupScriptCode from "./sandbox-scripts/providers/media-group/metron.sandbox.js" with { type: "text" };
import metronComicBookScriptCode from "./sandbox-scripts/providers/media/comic-book/metron.sandbox.js" with { type: "text" };
import vndbVisualNovelScriptCode from "./sandbox-scripts/providers/media/visual-novel/vndb.sandbox.js" with { type: "text" };
import metronPersonScriptCode from "./sandbox-scripts/providers/person/metron.sandbox.js" with { type: "text" };

const BUILTIN_ALLOWED_HOST_FUNCTIONS: string[] = [
	"httpCall",
	"getCachedValue",
	"setCachedValue",
	"getAppConfigValue",
	"getUserPreferences",
];

const script = (
	name: string,
	slug: string,
	code: string,
	requiredAppConfigKeys?: string[],
	providerInformation?: { source: string; canonicalLanguage?: string },
) => ({
	name,
	slug,
	code,
	metadata: {
		providerInformation,
		requiredAppConfigKeys,
		allowedHostFunctions: BUILTIN_ALLOWED_HOST_FUNCTIONS,
	},
});

const providerScript = (
	name: string,
	slug: string,
	code: string,
	source: string,
	requiredAppConfigKeys?: string[],
) => script(name, slug, code, requiredAppConfigKeys, { source });

export const builtinSandboxScripts = () => [
	providerScript(
		"Free Exercise DB",
		"exercise.free-exercise-db",
		freeExerciseDbScriptCode,
		"free-exercise-db",
	),
	sandboxBookDotOpenlibraryScript,
	sandboxAudiobookDotAudibleScript,
	sandboxPodcastDotItunesScript,
	providerScript("VNDB", "visual-novel.vndb", vndbVisualNovelScriptCode, "vndb"),
	sandboxAnimeDotAnilistScript,
	sandboxMangaDotAnilistScript,
	sandboxCompanyDotAnilistScript,
	sandboxCompanyDotGiantDashBombScript,
	sandboxCompanyDotHardcoverScript,
	sandboxCompanyDotIgdbScript,
	sandboxCompanyDotTmdbScript,
	sandboxCompanyDotTvdbScript,
	providerScript("VNDB", "company.vndb", vndbCompanyScriptCode, "vndb"),
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
	providerScript("Metron", "comic-book.metron", metronComicBookScriptCode, "metron", [
		"providers.metronUsername",
		"providers.metronPassword",
	]),
	providerScript("Metron", "person.metron", metronPersonScriptCode, "metron", [
		"providers.metronUsername",
		"providers.metronPassword",
	]),
	sandboxMusicDotSpotifyScript,
	sandboxPersonDotSpotifyScript,
	sandboxVideoDashGameDotIgdbScript,
	sandboxMovieDashGroupDotTmdbScript,
	sandboxMovieDashGroupDotTvdbScript,
	sandboxAudiobookDashGroupDotAudibleScript,
	sandboxBookDashGroupDotHardcoverScript,
	providerScript("Metron", "comic-book-group.metron", metronComicBookGroupScriptCode, "metron", [
		"providers.metronUsername",
		"providers.metronPassword",
	]),
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

const triggerLink = (
	entry: GeneratedBuiltinSandboxScript,
	input: {
		readonly position: number;
		readonly eventSchemaSlug: string;
		readonly metadata: { readonly inheritedProperties?: readonly string[] };
	},
) => {
	if (entry.manifest.kind !== "trigger") {
		throw new Error(`Built-in trigger link requires a trigger manifest: ${entry.slug}`);
	}
	return { ...input, scriptSlug: entry.slug, triggerName: entry.name, phase: entry.manifest.mode };
};

export const builtinEventSchemaTriggerLinks = () => [
	triggerLink(sandboxTriggerDotAutoDashCompleteDashOnDashFullDashProgressScript, {
		position: 1000,
		eventSchemaSlug: "progress",
		metadata: { inheritedProperties: ["consumedOn"] },
	}),
	triggerLink(sandboxTriggerDotIntegrationDashProgressDashPolicyScript, {
		metadata: {},
		position: 100,
		eventSchemaSlug: "progress",
	}),
	triggerLink(sandboxTriggerDotRadarrDashPushScript, {
		metadata: {},
		position: 1000,
		eventSchemaSlug: "add-entity-to-collection",
	}),
	triggerLink(sandboxTriggerDotSonarrDashPushScript, {
		metadata: {},
		position: 1000,
		eventSchemaSlug: "add-entity-to-collection",
	}),
	triggerLink(sandboxTriggerDotJellyfinDashPushScript, {
		metadata: {},
		position: 1000,
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
