import type { ActivityManifest, SandboxManifest } from "@ryot/sandbox-sdk/core";

import { manifest as manifest0 } from "./scripts/automations/auto-complete-on-full-progress.sandbox";
import { manifest as manifest1 } from "./scripts/automations/integration-progress-policy.sandbox";
import { manifest as manifest2 } from "./scripts/automations/jellyfin-push.sandbox";
import { manifest as manifest3 } from "./scripts/automations/media-association.sandbox";
import { manifest as manifest4 } from "./scripts/automations/media-entity-updated.sandbox";
import { manifest as manifest5 } from "./scripts/automations/media-relationship-sync.sandbox";
import { manifest as manifest6 } from "./scripts/automations/media-trending.sandbox";
import { manifest as manifest7 } from "./scripts/automations/notification.sandbox";
import { manifest as manifest8 } from "./scripts/automations/radarr-push.sandbox";
import { manifest as manifest9 } from "./scripts/automations/review-created.sandbox";
import { manifest as manifest10 } from "./scripts/automations/sonarr-push.sandbox";
import { manifest as manifest157 } from "./scripts/imports/anilist.sandbox";
import { manifest as manifest167 } from "./scripts/imports/audiobookshelf.sandbox";
import { manifest as manifest158 } from "./scripts/imports/goodreads.sandbox";
import { manifest as manifest159 } from "./scripts/imports/grouvee.sandbox";
import { manifest as manifest160 } from "./scripts/imports/hardcover.sandbox";
import { manifest as manifest161 } from "./scripts/imports/igdb.sandbox";
import { manifest as manifest162 } from "./scripts/imports/imdb.sandbox";
import { manifest as manifest156 } from "./scripts/imports/import.sandbox";
import { manifest as manifest168 } from "./scripts/imports/jellyfin.sandbox";
import { manifest as manifest169 } from "./scripts/imports/media-tracker.sandbox";
import { manifest as manifest164 } from "./scripts/imports/movary.sandbox";
import { manifest as manifest165 } from "./scripts/imports/myanimelist.sandbox";
import { manifest as manifest166 } from "./scripts/imports/netflix.sandbox";
import { manifest as manifest170 } from "./scripts/imports/plex.sandbox";
import { manifest as manifest154 } from "./scripts/imports/resolve-episodes.sandbox";
import { manifest as manifest163 } from "./scripts/imports/storygraph.sandbox";
import { manifest as manifest171 } from "./scripts/imports/trakt.sandbox";
import { manifest as manifest153 } from "./scripts/imports/watcharr.sandbox";
import { manifest as manifest155 } from "./scripts/imports/write-chunks.sandbox";
import { manifest as manifest143 } from "./scripts/integrations/sinks/browser-extension.sandbox";
import { manifest as manifest144 } from "./scripts/integrations/sinks/emby.sandbox";
import { manifest as manifest145 } from "./scripts/integrations/sinks/generic-json.sandbox";
import { manifest as manifest146 } from "./scripts/integrations/sinks/jellyfin.sandbox";
import { manifest as manifest147 } from "./scripts/integrations/sinks/kodi.sandbox";
import { manifest as manifest148 } from "./scripts/integrations/sinks/plex.sandbox";
import { manifest as manifest149 } from "./scripts/integrations/yanks/audiobookshelf.sandbox";
import { manifest as manifest150 } from "./scripts/integrations/yanks/komga.sandbox";
import { manifest as manifest151 } from "./scripts/integrations/yanks/plex.sandbox";
import { manifest as manifest152 } from "./scripts/integrations/yanks/youtube-music.sandbox";
import { manifest as manifest172 } from "./scripts/operations/media-monitoring-disable.sandbox";
import { manifest as manifest173 } from "./scripts/operations/media-monitoring-enable.sandbox";
import { manifest as manifest174 } from "./scripts/operations/media-monitoring-status.sandbox";
import { manifest as manifest11 } from "./scripts/operations/metadata-lookup.sandbox";
import { manifest as manifest12 } from "./scripts/operations/resolve-episodes.sandbox";
import { manifest as manifest13 } from "./scripts/providers/company/anilist-details.sandbox";
import { manifest as manifest14 } from "./scripts/providers/company/anilist-search.sandbox";
import { manifest as manifest15 } from "./scripts/providers/company/giant-bomb-details.sandbox";
import { manifest as manifest16 } from "./scripts/providers/company/giant-bomb-search.sandbox";
import { manifest as manifest17 } from "./scripts/providers/company/hardcover-details.sandbox";
import { manifest as manifest18 } from "./scripts/providers/company/hardcover-search.sandbox";
import { manifest as manifest19 } from "./scripts/providers/company/igdb-details.sandbox";
import { manifest as manifest20 } from "./scripts/providers/company/igdb-search.sandbox";
import { manifest as manifest21 } from "./scripts/providers/company/tmdb-details.sandbox";
import { manifest as manifest22 } from "./scripts/providers/company/tmdb-search.sandbox";
import { manifest as manifest23 } from "./scripts/providers/company/tvdb-details.sandbox";
import { manifest as manifest24 } from "./scripts/providers/company/tvdb-search.sandbox";
import { manifest as manifest25 } from "./scripts/providers/company/vndb-details.sandbox";
import { manifest as manifest26 } from "./scripts/providers/company/vndb-search.sandbox";
import { manifest as manifest27 } from "./scripts/providers/media-group/audible-details.sandbox";
import { manifest as manifest28 } from "./scripts/providers/media-group/audible-search.sandbox";
import { manifest as manifest29 } from "./scripts/providers/media-group/giant-bomb-details.sandbox";
import { manifest as manifest30 } from "./scripts/providers/media-group/giant-bomb-search.sandbox";
import { manifest as manifest31 } from "./scripts/providers/media-group/hardcover-details.sandbox";
import { manifest as manifest32 } from "./scripts/providers/media-group/hardcover-search.sandbox";
import { manifest as manifest33 } from "./scripts/providers/media-group/igdb-details.sandbox";
import { manifest as manifest34 } from "./scripts/providers/media-group/igdb-search.sandbox";
import { manifest as manifest35 } from "./scripts/providers/media-group/metron-details.sandbox";
import { manifest as manifest36 } from "./scripts/providers/media-group/metron-search.sandbox";
import { manifest as manifest37 } from "./scripts/providers/media-group/music-brainz-details.sandbox";
import { manifest as manifest38 } from "./scripts/providers/media-group/music-brainz-search.sandbox";
import { manifest as manifest39 } from "./scripts/providers/media-group/spotify-details.sandbox";
import { manifest as manifest40 } from "./scripts/providers/media-group/spotify-search.sandbox";
import { manifest as manifest41 } from "./scripts/providers/media-group/tmdb-details.sandbox";
import { manifest as manifest42 } from "./scripts/providers/media-group/tmdb-search.sandbox";
import { manifest as manifest43 } from "./scripts/providers/media-group/tmdb-translate.sandbox";
import { manifest as manifest44 } from "./scripts/providers/media-group/tvdb-details.sandbox";
import { manifest as manifest45 } from "./scripts/providers/media-group/tvdb-search.sandbox";
import { manifest as manifest46 } from "./scripts/providers/media-group/tvdb-translate.sandbox";
import { manifest as manifest47 } from "./scripts/providers/media-group/youtube-music.details.sandbox";
import { manifest as manifest48 } from "./scripts/providers/media-group/youtube-music.search.sandbox";
import { manifest as manifest49 } from "./scripts/providers/media-group/youtube-music.translate.sandbox";
import { manifest as manifest50 } from "./scripts/providers/media/anime/anilist-details.sandbox";
import { manifest as manifest51 } from "./scripts/providers/media/anime/anilist-search.sandbox";
import { manifest as manifest52 } from "./scripts/providers/media/anime/anilist-translate.sandbox";
import { manifest as manifest53 } from "./scripts/providers/media/anime/myanimelist-details.sandbox";
import { manifest as manifest54 } from "./scripts/providers/media/anime/myanimelist-search.sandbox";
import { manifest as manifest55 } from "./scripts/providers/media/audiobook/audible-details.sandbox";
import { manifest as manifest56 } from "./scripts/providers/media/audiobook/audible-search.sandbox";
import { manifest as manifest57 } from "./scripts/providers/media/book/google-books-details.sandbox";
import { manifest as manifest58 } from "./scripts/providers/media/book/google-books-resolve.sandbox";
import { manifest as manifest59 } from "./scripts/providers/media/book/google-books-search.sandbox";
import { manifest as manifest60 } from "./scripts/providers/media/book/hardcover-details.sandbox";
import { manifest as manifest61 } from "./scripts/providers/media/book/hardcover-resolve.sandbox";
import { manifest as manifest62 } from "./scripts/providers/media/book/hardcover-search.sandbox";
import { manifest as manifest63 } from "./scripts/providers/media/book/openlibrary-details.sandbox";
import { manifest as manifest64 } from "./scripts/providers/media/book/openlibrary-resolve.sandbox";
import { manifest as manifest65 } from "./scripts/providers/media/book/openlibrary-search.sandbox";
import { manifest as manifest66 } from "./scripts/providers/media/comic-book/metron-details.sandbox";
import { manifest as manifest67 } from "./scripts/providers/media/comic-book/metron-search.sandbox";
import { manifest as manifest68 } from "./scripts/providers/media/manga/anilist-details.sandbox";
import { manifest as manifest69 } from "./scripts/providers/media/manga/anilist-search.sandbox";
import { manifest as manifest70 } from "./scripts/providers/media/manga/anilist-translate.sandbox";
import { manifest as manifest71 } from "./scripts/providers/media/manga/manga-updates-details.sandbox";
import { manifest as manifest72 } from "./scripts/providers/media/manga/manga-updates-search.sandbox";
import { manifest as manifest73 } from "./scripts/providers/media/manga/myanimelist-details.sandbox";
import { manifest as manifest74 } from "./scripts/providers/media/manga/myanimelist-search.sandbox";
import { manifest as manifest75 } from "./scripts/providers/media/movie/tmdb-details.sandbox";
import { manifest as manifest76 } from "./scripts/providers/media/movie/tmdb-resolve.sandbox";
import { manifest as manifest77 } from "./scripts/providers/media/movie/tmdb-search.sandbox";
import { manifest as manifest78 } from "./scripts/providers/media/movie/tmdb-translate.sandbox";
import { manifest as manifest134 } from "./scripts/providers/media/movie/tmdb-trending.sandbox";
import { manifest as manifest79 } from "./scripts/providers/media/movie/tvdb-details.sandbox";
import { manifest as manifest80 } from "./scripts/providers/media/movie/tvdb-search.sandbox";
import { manifest as manifest81 } from "./scripts/providers/media/movie/tvdb-translate.sandbox";
import { manifest as manifest82 } from "./scripts/providers/media/music/music-brainz-details.sandbox";
import { manifest as manifest83 } from "./scripts/providers/media/music/music-brainz-search.sandbox";
import { manifest as manifest84 } from "./scripts/providers/media/music/spotify-details.sandbox";
import { manifest as manifest85 } from "./scripts/providers/media/music/spotify-search.sandbox";
import { manifest as manifest86 } from "./scripts/providers/media/music/youtube-music.details.sandbox";
import { manifest as manifest87 } from "./scripts/providers/media/music/youtube-music.history.sandbox";
import { manifest as manifest88 } from "./scripts/providers/media/music/youtube-music.search.sandbox";
import { manifest as manifest89 } from "./scripts/providers/media/music/youtube-music.translate.sandbox";
import { manifest as manifest90 } from "./scripts/providers/media/podcast/itunes-details.sandbox";
import { manifest as manifest91 } from "./scripts/providers/media/podcast/itunes-search.sandbox";
import { manifest as manifest92 } from "./scripts/providers/media/podcast/itunes-translate.sandbox";
import { manifest as manifest93 } from "./scripts/providers/media/podcast/listennotes-details.sandbox";
import { manifest as manifest94 } from "./scripts/providers/media/podcast/listennotes-search.sandbox";
import { manifest as manifest95 } from "./scripts/providers/media/show/tmdb-details.sandbox";
import { manifest as manifest96 } from "./scripts/providers/media/show/tmdb-resolve.sandbox";
import { manifest as manifest97 } from "./scripts/providers/media/show/tmdb-search.sandbox";
import { manifest as manifest98 } from "./scripts/providers/media/show/tmdb-translate.sandbox";
import { manifest as manifest135 } from "./scripts/providers/media/show/tmdb-trending.sandbox";
import { manifest as manifest99 } from "./scripts/providers/media/show/tvdb-details.sandbox";
import { manifest as manifest100 } from "./scripts/providers/media/show/tvdb-search.sandbox";
import { manifest as manifest101 } from "./scripts/providers/media/show/tvdb-translate.sandbox";
import { manifest as manifest102 } from "./scripts/providers/media/video-game/giant-bomb-details.sandbox";
import { manifest as manifest103 } from "./scripts/providers/media/video-game/giant-bomb-search.sandbox";
import { manifest as manifest104 } from "./scripts/providers/media/video-game/igdb-details.sandbox";
import { manifest as manifest105 } from "./scripts/providers/media/video-game/igdb-search.sandbox";
import { manifest as manifest106 } from "./scripts/providers/media/visual-novel/vndb-details.sandbox";
import { manifest as manifest107 } from "./scripts/providers/media/visual-novel/vndb-search.sandbox";
import { manifest as manifest108 } from "./scripts/providers/person/anilist.details.sandbox";
import { manifest as manifest109 } from "./scripts/providers/person/anilist.search.sandbox";
import { manifest as manifest110 } from "./scripts/providers/person/audible.details.sandbox";
import { manifest as manifest111 } from "./scripts/providers/person/audible.search.sandbox";
import { manifest as manifest112 } from "./scripts/providers/person/giant-bomb.details.sandbox";
import { manifest as manifest113 } from "./scripts/providers/person/giant-bomb.search.sandbox";
import { manifest as manifest114 } from "./scripts/providers/person/hardcover.details.sandbox";
import { manifest as manifest115 } from "./scripts/providers/person/hardcover.search.sandbox";
import { manifest as manifest116 } from "./scripts/providers/person/manga-updates.details.sandbox";
import { manifest as manifest117 } from "./scripts/providers/person/manga-updates.search.sandbox";
import { manifest as manifest118 } from "./scripts/providers/person/metron.details.sandbox";
import { manifest as manifest119 } from "./scripts/providers/person/metron.search.sandbox";
import { manifest as manifest120 } from "./scripts/providers/person/music-brainz.details.sandbox";
import { manifest as manifest121 } from "./scripts/providers/person/music-brainz.search.sandbox";
import { manifest as manifest122 } from "./scripts/providers/person/openlibrary.details.sandbox";
import { manifest as manifest123 } from "./scripts/providers/person/spotify.details.sandbox";
import { manifest as manifest124 } from "./scripts/providers/person/spotify.search.sandbox";
import { manifest as manifest125 } from "./scripts/providers/person/tmdb.details.sandbox";
import { manifest as manifest126 } from "./scripts/providers/person/tmdb.search.sandbox";
import { manifest as manifest127 } from "./scripts/providers/person/tmdb.translate.sandbox";
import { manifest as manifest128 } from "./scripts/providers/person/tvdb.details.sandbox";
import { manifest as manifest129 } from "./scripts/providers/person/tvdb.search.sandbox";
import { manifest as manifest130 } from "./scripts/providers/person/tvdb.translate.sandbox";
import { manifest as manifest131 } from "./scripts/providers/person/youtube-music.details.sandbox";
import { manifest as manifest132 } from "./scripts/providers/person/youtube-music.search.sandbox";
import { manifest as manifest133 } from "./scripts/providers/person/youtube-music.translate.sandbox";
import { manifest as manifest136 } from "./scripts/workflows/media-import-population.sandbox";
import { manifest as manifest137 } from "./scripts/workflows/media-import-resolution.sandbox";
import { manifest as manifest175 } from "./scripts/workflows/media-monitoring-sweep.sandbox";
import { manifest as manifest176 } from "./scripts/workflows/media-monitoring-targets.sandbox";
import { manifest as manifest138 } from "./scripts/workflows/resolve-book-google-books.sandbox";
import { manifest as manifest139 } from "./scripts/workflows/resolve-book-hardcover.sandbox";
import { manifest as manifest140 } from "./scripts/workflows/resolve-book-openlibrary.sandbox";
import { manifest as manifest141 } from "./scripts/workflows/resolve-movie-tmdb.sandbox";
import { manifest as manifest142 } from "./scripts/workflows/resolve-show-tmdb.sandbox";

type ProviderOperation = "details" | "resolve" | "search" | "translate";

const directScript = <const Manifest extends SandboxManifest>(
	manifest: Manifest,
	entry: string,
) => ({ ...manifest, entry });

const providerScript = <const Manifest extends SandboxManifest>(
	manifest: Manifest,
	entry: string,
	providerSlug: string,
	providerOperation: ProviderOperation,
) => ({ ...directScript(manifest, entry), providerSlug, providerOperation });

const providerActivity = <const Manifest extends ActivityManifest>(
	manifest: Manifest,
	entry: string,
	providerSlug: string,
) => ({ ...directScript(manifest, entry), providerSlug });

export const mediaScripts = [
	directScript(manifest0, "scripts/automations/auto-complete-on-full-progress.sandbox.ts"),
	directScript(manifest1, "scripts/automations/integration-progress-policy.sandbox.ts"),
	directScript(manifest2, "scripts/automations/jellyfin-push.sandbox.ts"),
	directScript(manifest3, "scripts/automations/media-association.sandbox.ts"),
	directScript(manifest4, "scripts/automations/media-entity-updated.sandbox.ts"),
	directScript(manifest5, "scripts/automations/media-relationship-sync.sandbox.ts"),
	directScript(manifest6, "scripts/automations/media-trending.sandbox.ts"),
	directScript(manifest7, "scripts/automations/notification.sandbox.ts"),
	directScript(manifest8, "scripts/automations/radarr-push.sandbox.ts"),
	directScript(manifest9, "scripts/automations/review-created.sandbox.ts"),
	directScript(manifest10, "scripts/automations/sonarr-push.sandbox.ts"),
	directScript(manifest153, "scripts/imports/watcharr.sandbox.ts"),
	directScript(manifest154, "scripts/imports/resolve-episodes.sandbox.ts"),
	directScript(manifest155, "scripts/imports/write-chunks.sandbox.ts"),
	directScript(manifest156, "scripts/imports/import.sandbox.ts"),
	directScript(manifest157, "scripts/imports/anilist.sandbox.ts"),
	directScript(manifest158, "scripts/imports/goodreads.sandbox.ts"),
	directScript(manifest159, "scripts/imports/grouvee.sandbox.ts"),
	directScript(manifest160, "scripts/imports/hardcover.sandbox.ts"),
	directScript(manifest161, "scripts/imports/igdb.sandbox.ts"),
	directScript(manifest162, "scripts/imports/imdb.sandbox.ts"),
	directScript(manifest163, "scripts/imports/storygraph.sandbox.ts"),
	directScript(manifest164, "scripts/imports/movary.sandbox.ts"),
	directScript(manifest165, "scripts/imports/myanimelist.sandbox.ts"),
	directScript(manifest166, "scripts/imports/netflix.sandbox.ts"),
	directScript(manifest167, "scripts/imports/audiobookshelf.sandbox.ts"),
	directScript(manifest168, "scripts/imports/jellyfin.sandbox.ts"),
	directScript(manifest169, "scripts/imports/media-tracker.sandbox.ts"),
	directScript(manifest170, "scripts/imports/plex.sandbox.ts"),
	directScript(manifest171, "scripts/imports/trakt.sandbox.ts"),
	directScript(manifest11, "scripts/operations/metadata-lookup.sandbox.ts"),
	directScript(manifest12, "scripts/operations/resolve-episodes.sandbox.ts"),
	directScript(manifest172, "scripts/operations/media-monitoring-disable.sandbox.ts"),
	directScript(manifest173, "scripts/operations/media-monitoring-enable.sandbox.ts"),
	directScript(manifest174, "scripts/operations/media-monitoring-status.sandbox.ts"),
	directScript(manifest143, "scripts/integrations/sinks/browser-extension.sandbox.ts"),
	directScript(manifest144, "scripts/integrations/sinks/emby.sandbox.ts"),
	directScript(manifest145, "scripts/integrations/sinks/generic-json.sandbox.ts"),
	directScript(manifest146, "scripts/integrations/sinks/jellyfin.sandbox.ts"),
	directScript(manifest147, "scripts/integrations/sinks/kodi.sandbox.ts"),
	directScript(manifest148, "scripts/integrations/sinks/plex.sandbox.ts"),
	directScript(manifest149, "scripts/integrations/yanks/audiobookshelf.sandbox.ts"),
	directScript(manifest150, "scripts/integrations/yanks/komga.sandbox.ts"),
	directScript(manifest151, "scripts/integrations/yanks/plex.sandbox.ts"),
	directScript(manifest152, "scripts/integrations/yanks/youtube-music.sandbox.ts"),
	providerScript(
		manifest13,
		"scripts/providers/company/anilist-details.sandbox.ts",
		"company.anilist",
		"details",
	),
	providerScript(
		manifest14,
		"scripts/providers/company/anilist-search.sandbox.ts",
		"company.anilist",
		"search",
	),
	providerScript(
		manifest15,
		"scripts/providers/company/giant-bomb-details.sandbox.ts",
		"company.giant-bomb",
		"details",
	),
	providerScript(
		manifest16,
		"scripts/providers/company/giant-bomb-search.sandbox.ts",
		"company.giant-bomb",
		"search",
	),
	providerScript(
		manifest17,
		"scripts/providers/company/hardcover-details.sandbox.ts",
		"company.hardcover",
		"details",
	),
	providerScript(
		manifest18,
		"scripts/providers/company/hardcover-search.sandbox.ts",
		"company.hardcover",
		"search",
	),
	providerScript(
		manifest19,
		"scripts/providers/company/igdb-details.sandbox.ts",
		"company.igdb",
		"details",
	),
	providerScript(
		manifest20,
		"scripts/providers/company/igdb-search.sandbox.ts",
		"company.igdb",
		"search",
	),
	providerScript(
		manifest21,
		"scripts/providers/company/tmdb-details.sandbox.ts",
		"company.tmdb",
		"details",
	),
	providerScript(
		manifest22,
		"scripts/providers/company/tmdb-search.sandbox.ts",
		"company.tmdb",
		"search",
	),
	providerScript(
		manifest23,
		"scripts/providers/company/tvdb-details.sandbox.ts",
		"company.tvdb",
		"details",
	),
	providerScript(
		manifest24,
		"scripts/providers/company/tvdb-search.sandbox.ts",
		"company.tvdb",
		"search",
	),
	providerScript(
		manifest25,
		"scripts/providers/company/vndb-details.sandbox.ts",
		"company.vndb",
		"details",
	),
	providerScript(
		manifest26,
		"scripts/providers/company/vndb-search.sandbox.ts",
		"company.vndb",
		"search",
	),
	providerScript(
		manifest27,
		"scripts/providers/media-group/audible-details.sandbox.ts",
		"audiobook-group.audible",
		"details",
	),
	providerScript(
		manifest28,
		"scripts/providers/media-group/audible-search.sandbox.ts",
		"audiobook-group.audible",
		"search",
	),
	providerScript(
		manifest29,
		"scripts/providers/media-group/giant-bomb-details.sandbox.ts",
		"video-game-group.giant-bomb",
		"details",
	),
	providerScript(
		manifest30,
		"scripts/providers/media-group/giant-bomb-search.sandbox.ts",
		"video-game-group.giant-bomb",
		"search",
	),
	providerScript(
		manifest31,
		"scripts/providers/media-group/hardcover-details.sandbox.ts",
		"book-group.hardcover",
		"details",
	),
	providerScript(
		manifest32,
		"scripts/providers/media-group/hardcover-search.sandbox.ts",
		"book-group.hardcover",
		"search",
	),
	providerScript(
		manifest33,
		"scripts/providers/media-group/igdb-details.sandbox.ts",
		"video-game-group.igdb",
		"details",
	),
	providerScript(
		manifest34,
		"scripts/providers/media-group/igdb-search.sandbox.ts",
		"video-game-group.igdb",
		"search",
	),
	providerScript(
		manifest35,
		"scripts/providers/media-group/metron-details.sandbox.ts",
		"comic-book-group.metron",
		"details",
	),
	providerScript(
		manifest36,
		"scripts/providers/media-group/metron-search.sandbox.ts",
		"comic-book-group.metron",
		"search",
	),
	providerScript(
		manifest37,
		"scripts/providers/media-group/music-brainz-details.sandbox.ts",
		"music-group.music-brainz",
		"details",
	),
	providerScript(
		manifest38,
		"scripts/providers/media-group/music-brainz-search.sandbox.ts",
		"music-group.music-brainz",
		"search",
	),
	providerScript(
		manifest39,
		"scripts/providers/media-group/spotify-details.sandbox.ts",
		"music-group.spotify",
		"details",
	),
	providerScript(
		manifest40,
		"scripts/providers/media-group/spotify-search.sandbox.ts",
		"music-group.spotify",
		"search",
	),
	providerScript(
		manifest41,
		"scripts/providers/media-group/tmdb-details.sandbox.ts",
		"movie-group.tmdb",
		"details",
	),
	providerScript(
		manifest42,
		"scripts/providers/media-group/tmdb-search.sandbox.ts",
		"movie-group.tmdb",
		"search",
	),
	providerScript(
		manifest43,
		"scripts/providers/media-group/tmdb-translate.sandbox.ts",
		"movie-group.tmdb",
		"translate",
	),
	providerScript(
		manifest44,
		"scripts/providers/media-group/tvdb-details.sandbox.ts",
		"movie-group.tvdb",
		"details",
	),
	providerScript(
		manifest45,
		"scripts/providers/media-group/tvdb-search.sandbox.ts",
		"movie-group.tvdb",
		"search",
	),
	providerScript(
		manifest46,
		"scripts/providers/media-group/tvdb-translate.sandbox.ts",
		"movie-group.tvdb",
		"translate",
	),
	providerScript(
		manifest47,
		"scripts/providers/media-group/youtube-music.details.sandbox.ts",
		"music-group.youtube-music",
		"details",
	),
	providerScript(
		manifest48,
		"scripts/providers/media-group/youtube-music.search.sandbox.ts",
		"music-group.youtube-music",
		"search",
	),
	providerScript(
		manifest49,
		"scripts/providers/media-group/youtube-music.translate.sandbox.ts",
		"music-group.youtube-music",
		"translate",
	),
	providerScript(
		manifest50,
		"scripts/providers/media/anime/anilist-details.sandbox.ts",
		"anime.anilist",
		"details",
	),
	providerScript(
		manifest51,
		"scripts/providers/media/anime/anilist-search.sandbox.ts",
		"anime.anilist",
		"search",
	),
	providerScript(
		manifest52,
		"scripts/providers/media/anime/anilist-translate.sandbox.ts",
		"anime.anilist",
		"translate",
	),
	providerScript(
		manifest53,
		"scripts/providers/media/anime/myanimelist-details.sandbox.ts",
		"anime.myanimelist",
		"details",
	),
	providerScript(
		manifest54,
		"scripts/providers/media/anime/myanimelist-search.sandbox.ts",
		"anime.myanimelist",
		"search",
	),
	providerScript(
		manifest55,
		"scripts/providers/media/audiobook/audible-details.sandbox.ts",
		"audiobook.audible",
		"details",
	),
	providerScript(
		manifest56,
		"scripts/providers/media/audiobook/audible-search.sandbox.ts",
		"audiobook.audible",
		"search",
	),
	providerScript(
		manifest57,
		"scripts/providers/media/book/google-books-details.sandbox.ts",
		"book.google-books",
		"details",
	),
	providerScript(
		manifest58,
		"scripts/providers/media/book/google-books-resolve.sandbox.ts",
		"book.google-books",
		"resolve",
	),
	providerScript(
		manifest59,
		"scripts/providers/media/book/google-books-search.sandbox.ts",
		"book.google-books",
		"search",
	),
	providerScript(
		manifest60,
		"scripts/providers/media/book/hardcover-details.sandbox.ts",
		"book.hardcover",
		"details",
	),
	providerScript(
		manifest61,
		"scripts/providers/media/book/hardcover-resolve.sandbox.ts",
		"book.hardcover",
		"resolve",
	),
	providerScript(
		manifest62,
		"scripts/providers/media/book/hardcover-search.sandbox.ts",
		"book.hardcover",
		"search",
	),
	providerScript(
		manifest63,
		"scripts/providers/media/book/openlibrary-details.sandbox.ts",
		"book.openlibrary",
		"details",
	),
	providerScript(
		manifest64,
		"scripts/providers/media/book/openlibrary-resolve.sandbox.ts",
		"book.openlibrary",
		"resolve",
	),
	providerScript(
		manifest65,
		"scripts/providers/media/book/openlibrary-search.sandbox.ts",
		"book.openlibrary",
		"search",
	),
	providerScript(
		manifest66,
		"scripts/providers/media/comic-book/metron-details.sandbox.ts",
		"comic-book.metron",
		"details",
	),
	providerScript(
		manifest67,
		"scripts/providers/media/comic-book/metron-search.sandbox.ts",
		"comic-book.metron",
		"search",
	),
	providerScript(
		manifest68,
		"scripts/providers/media/manga/anilist-details.sandbox.ts",
		"manga.anilist",
		"details",
	),
	providerScript(
		manifest69,
		"scripts/providers/media/manga/anilist-search.sandbox.ts",
		"manga.anilist",
		"search",
	),
	providerScript(
		manifest70,
		"scripts/providers/media/manga/anilist-translate.sandbox.ts",
		"manga.anilist",
		"translate",
	),
	providerScript(
		manifest71,
		"scripts/providers/media/manga/manga-updates-details.sandbox.ts",
		"manga.manga-updates",
		"details",
	),
	providerScript(
		manifest72,
		"scripts/providers/media/manga/manga-updates-search.sandbox.ts",
		"manga.manga-updates",
		"search",
	),
	providerScript(
		manifest73,
		"scripts/providers/media/manga/myanimelist-details.sandbox.ts",
		"manga.myanimelist",
		"details",
	),
	providerScript(
		manifest74,
		"scripts/providers/media/manga/myanimelist-search.sandbox.ts",
		"manga.myanimelist",
		"search",
	),
	providerScript(
		manifest75,
		"scripts/providers/media/movie/tmdb-details.sandbox.ts",
		"movie.tmdb",
		"details",
	),
	providerScript(
		manifest76,
		"scripts/providers/media/movie/tmdb-resolve.sandbox.ts",
		"movie.tmdb",
		"resolve",
	),
	providerScript(
		manifest77,
		"scripts/providers/media/movie/tmdb-search.sandbox.ts",
		"movie.tmdb",
		"search",
	),
	providerScript(
		manifest78,
		"scripts/providers/media/movie/tmdb-translate.sandbox.ts",
		"movie.tmdb",
		"translate",
	),
	{
		...directScript(manifest134, "scripts/providers/media/movie/tmdb-trending.sandbox.ts"),
		providerSlug: "movie.tmdb",
	},
	providerScript(
		manifest79,
		"scripts/providers/media/movie/tvdb-details.sandbox.ts",
		"movie.tvdb",
		"details",
	),
	providerScript(
		manifest80,
		"scripts/providers/media/movie/tvdb-search.sandbox.ts",
		"movie.tvdb",
		"search",
	),
	providerScript(
		manifest81,
		"scripts/providers/media/movie/tvdb-translate.sandbox.ts",
		"movie.tvdb",
		"translate",
	),
	providerScript(
		manifest82,
		"scripts/providers/media/music/music-brainz-details.sandbox.ts",
		"music.music-brainz",
		"details",
	),
	providerScript(
		manifest83,
		"scripts/providers/media/music/music-brainz-search.sandbox.ts",
		"music.music-brainz",
		"search",
	),
	providerScript(
		manifest84,
		"scripts/providers/media/music/spotify-details.sandbox.ts",
		"music.spotify",
		"details",
	),
	providerScript(
		manifest85,
		"scripts/providers/media/music/spotify-search.sandbox.ts",
		"music.spotify",
		"search",
	),
	providerScript(
		manifest86,
		"scripts/providers/media/music/youtube-music.details.sandbox.ts",
		"music.youtube-music",
		"details",
	),
	{
		...directScript(manifest87, "scripts/providers/media/music/youtube-music.history.sandbox.ts"),
		providerSlug: "music.youtube-music",
	},
	providerScript(
		manifest88,
		"scripts/providers/media/music/youtube-music.search.sandbox.ts",
		"music.youtube-music",
		"search",
	),
	providerScript(
		manifest89,
		"scripts/providers/media/music/youtube-music.translate.sandbox.ts",
		"music.youtube-music",
		"translate",
	),
	providerScript(
		manifest90,
		"scripts/providers/media/podcast/itunes-details.sandbox.ts",
		"podcast.itunes",
		"details",
	),
	providerScript(
		manifest91,
		"scripts/providers/media/podcast/itunes-search.sandbox.ts",
		"podcast.itunes",
		"search",
	),
	providerScript(
		manifest92,
		"scripts/providers/media/podcast/itunes-translate.sandbox.ts",
		"podcast.itunes",
		"translate",
	),
	providerScript(
		manifest93,
		"scripts/providers/media/podcast/listennotes-details.sandbox.ts",
		"podcast.listennotes",
		"details",
	),
	providerScript(
		manifest94,
		"scripts/providers/media/podcast/listennotes-search.sandbox.ts",
		"podcast.listennotes",
		"search",
	),
	providerScript(
		manifest95,
		"scripts/providers/media/show/tmdb-details.sandbox.ts",
		"show.tmdb",
		"details",
	),
	providerScript(
		manifest96,
		"scripts/providers/media/show/tmdb-resolve.sandbox.ts",
		"show.tmdb",
		"resolve",
	),
	providerScript(
		manifest97,
		"scripts/providers/media/show/tmdb-search.sandbox.ts",
		"show.tmdb",
		"search",
	),
	providerScript(
		manifest98,
		"scripts/providers/media/show/tmdb-translate.sandbox.ts",
		"show.tmdb",
		"translate",
	),
	{
		...directScript(manifest135, "scripts/providers/media/show/tmdb-trending.sandbox.ts"),
		providerSlug: "show.tmdb",
	},
	providerScript(
		manifest99,
		"scripts/providers/media/show/tvdb-details.sandbox.ts",
		"show.tvdb",
		"details",
	),
	providerScript(
		manifest100,
		"scripts/providers/media/show/tvdb-search.sandbox.ts",
		"show.tvdb",
		"search",
	),
	providerScript(
		manifest101,
		"scripts/providers/media/show/tvdb-translate.sandbox.ts",
		"show.tvdb",
		"translate",
	),
	providerScript(
		manifest102,
		"scripts/providers/media/video-game/giant-bomb-details.sandbox.ts",
		"video-game.giant-bomb",
		"details",
	),
	providerScript(
		manifest103,
		"scripts/providers/media/video-game/giant-bomb-search.sandbox.ts",
		"video-game.giant-bomb",
		"search",
	),
	providerScript(
		manifest104,
		"scripts/providers/media/video-game/igdb-details.sandbox.ts",
		"video-game.igdb",
		"details",
	),
	providerScript(
		manifest105,
		"scripts/providers/media/video-game/igdb-search.sandbox.ts",
		"video-game.igdb",
		"search",
	),
	providerScript(
		manifest106,
		"scripts/providers/media/visual-novel/vndb-details.sandbox.ts",
		"visual-novel.vndb",
		"details",
	),
	providerScript(
		manifest107,
		"scripts/providers/media/visual-novel/vndb-search.sandbox.ts",
		"visual-novel.vndb",
		"search",
	),
	providerScript(
		manifest108,
		"scripts/providers/person/anilist.details.sandbox.ts",
		"person.anilist",
		"details",
	),
	providerScript(
		manifest109,
		"scripts/providers/person/anilist.search.sandbox.ts",
		"person.anilist",
		"search",
	),
	providerScript(
		manifest110,
		"scripts/providers/person/audible.details.sandbox.ts",
		"person.audible",
		"details",
	),
	providerScript(
		manifest111,
		"scripts/providers/person/audible.search.sandbox.ts",
		"person.audible",
		"search",
	),
	providerScript(
		manifest112,
		"scripts/providers/person/giant-bomb.details.sandbox.ts",
		"person.giant-bomb",
		"details",
	),
	providerScript(
		manifest113,
		"scripts/providers/person/giant-bomb.search.sandbox.ts",
		"person.giant-bomb",
		"search",
	),
	providerScript(
		manifest114,
		"scripts/providers/person/hardcover.details.sandbox.ts",
		"person.hardcover",
		"details",
	),
	providerScript(
		manifest115,
		"scripts/providers/person/hardcover.search.sandbox.ts",
		"person.hardcover",
		"search",
	),
	providerScript(
		manifest116,
		"scripts/providers/person/manga-updates.details.sandbox.ts",
		"person.manga-updates",
		"details",
	),
	providerScript(
		manifest117,
		"scripts/providers/person/manga-updates.search.sandbox.ts",
		"person.manga-updates",
		"search",
	),
	providerScript(
		manifest118,
		"scripts/providers/person/metron.details.sandbox.ts",
		"person.metron",
		"details",
	),
	providerScript(
		manifest119,
		"scripts/providers/person/metron.search.sandbox.ts",
		"person.metron",
		"search",
	),
	providerScript(
		manifest120,
		"scripts/providers/person/music-brainz.details.sandbox.ts",
		"person.music-brainz",
		"details",
	),
	providerScript(
		manifest121,
		"scripts/providers/person/music-brainz.search.sandbox.ts",
		"person.music-brainz",
		"search",
	),
	providerScript(
		manifest122,
		"scripts/providers/person/openlibrary.details.sandbox.ts",
		"person.openlibrary",
		"details",
	),
	providerScript(
		manifest123,
		"scripts/providers/person/spotify.details.sandbox.ts",
		"person.spotify",
		"details",
	),
	providerScript(
		manifest124,
		"scripts/providers/person/spotify.search.sandbox.ts",
		"person.spotify",
		"search",
	),
	providerScript(
		manifest125,
		"scripts/providers/person/tmdb.details.sandbox.ts",
		"person.tmdb",
		"details",
	),
	providerScript(
		manifest126,
		"scripts/providers/person/tmdb.search.sandbox.ts",
		"person.tmdb",
		"search",
	),
	providerScript(
		manifest127,
		"scripts/providers/person/tmdb.translate.sandbox.ts",
		"person.tmdb",
		"translate",
	),
	providerScript(
		manifest128,
		"scripts/providers/person/tvdb.details.sandbox.ts",
		"person.tvdb",
		"details",
	),
	providerScript(
		manifest129,
		"scripts/providers/person/tvdb.search.sandbox.ts",
		"person.tvdb",
		"search",
	),
	providerScript(
		manifest130,
		"scripts/providers/person/tvdb.translate.sandbox.ts",
		"person.tvdb",
		"translate",
	),
	providerScript(
		manifest131,
		"scripts/providers/person/youtube-music.details.sandbox.ts",
		"person.youtube-music",
		"details",
	),
	providerScript(
		manifest132,
		"scripts/providers/person/youtube-music.search.sandbox.ts",
		"person.youtube-music",
		"search",
	),
	providerScript(
		manifest133,
		"scripts/providers/person/youtube-music.translate.sandbox.ts",
		"person.youtube-music",
		"translate",
	),
	directScript(manifest136, "scripts/workflows/media-import-population.sandbox.ts"),
	directScript(manifest137, "scripts/workflows/media-import-resolution.sandbox.ts"),
	directScript(manifest175, "scripts/workflows/media-monitoring-sweep.sandbox.ts"),
	directScript(manifest176, "scripts/workflows/media-monitoring-targets.sandbox.ts"),
	providerActivity(
		manifest138,
		"scripts/workflows/resolve-book-google-books.sandbox.ts",
		"book.google-books",
	),
	providerActivity(
		manifest139,
		"scripts/workflows/resolve-book-hardcover.sandbox.ts",
		"book.hardcover",
	),
	providerActivity(
		manifest140,
		"scripts/workflows/resolve-book-openlibrary.sandbox.ts",
		"book.openlibrary",
	),
	providerActivity(manifest141, "scripts/workflows/resolve-movie-tmdb.sandbox.ts", "movie.tmdb"),
	providerActivity(manifest142, "scripts/workflows/resolve-show-tmdb.sandbox.ts", "show.tmdb"),
] as const;
