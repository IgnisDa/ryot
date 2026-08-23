import type { SandboxManifest } from "@ryot-app/sandbox-sdk/core";

import { manifest as manifest181 } from "../backend/automations/auto-complete-episodic-parent.sandbox";
import { manifest as manifest0 } from "../backend/automations/auto-complete-on-full-progress.sandbox";
import { manifest as manifest182 } from "../backend/automations/episodic-session-policy.sandbox";
import { manifest as manifest1 } from "../backend/automations/integration-progress-policy.sandbox";
import { manifest as manifest2 } from "../backend/automations/jellyfin-push.sandbox";
import { manifest as manifest178 } from "../backend/automations/library-membership-policy.sandbox";
import { manifest as manifest3 } from "../backend/automations/media-association.sandbox";
import { manifest as manifest4 } from "../backend/automations/media-entity-updated.sandbox";
import { manifest as manifest180 } from "../backend/automations/media-library-membership-on-import.sandbox";
import { manifest as manifest5 } from "../backend/automations/media-relationship-sync.sandbox";
import { manifest as manifest6 } from "../backend/automations/media-trending.sandbox";
import { manifest as manifest7 } from "../backend/automations/notification.sandbox";
import { manifest as manifest8 } from "../backend/automations/radarr-push.sandbox";
import { manifest as manifest9 } from "../backend/automations/review-created.sandbox";
import { manifest as manifest10 } from "../backend/automations/sonarr-push.sandbox";
import { manifest as manifest177 } from "../backend/bootstrap/user-bootstrap.sandbox";
import { manifest as manifest157 } from "../backend/imports/anilist.sandbox";
import { manifest as manifest167 } from "../backend/imports/audiobookshelf.sandbox";
import { manifest as manifest158 } from "../backend/imports/goodreads.sandbox";
import { manifest as manifest159 } from "../backend/imports/grouvee.sandbox";
import { manifest as manifest160 } from "../backend/imports/hardcover.sandbox";
import { manifest as manifest161 } from "../backend/imports/igdb.sandbox";
import { manifest as manifest162 } from "../backend/imports/imdb.sandbox";
import { manifest as manifest156 } from "../backend/imports/import.sandbox";
import { manifest as manifest168 } from "../backend/imports/jellyfin.sandbox";
import { manifest as manifest169 } from "../backend/imports/media-tracker.sandbox";
import { manifest as manifest164 } from "../backend/imports/movary.sandbox";
import { manifest as manifest165 } from "../backend/imports/myanimelist.sandbox";
import { manifest as manifest166 } from "../backend/imports/netflix.sandbox";
import { manifest as manifest170 } from "../backend/imports/plex.sandbox";
import { manifest as manifest154 } from "../backend/imports/resolve-episodes.sandbox";
import { manifest as manifest163 } from "../backend/imports/storygraph.sandbox";
import { manifest as manifest171 } from "../backend/imports/trakt.sandbox";
import { manifest as manifest153 } from "../backend/imports/watcharr.sandbox";
import { manifest as manifest155 } from "../backend/imports/write-chunks.sandbox";
import { manifest as manifest143 } from "../backend/integrations/sinks/browser-extension.sandbox";
import { manifest as manifest144 } from "../backend/integrations/sinks/emby.sandbox";
import { manifest as manifest146 } from "../backend/integrations/sinks/jellyfin.sandbox";
import { manifest as manifest147 } from "../backend/integrations/sinks/kodi.sandbox";
import { manifest as manifest148 } from "../backend/integrations/sinks/plex.sandbox";
import { manifest as manifest149 } from "../backend/integrations/yanks/audiobookshelf.sandbox";
import { manifest as manifest150 } from "../backend/integrations/yanks/komga.sandbox";
import { manifest as manifest151 } from "../backend/integrations/yanks/plex.sandbox";
import { manifest as manifest152 } from "../backend/integrations/yanks/youtube-music.sandbox";
import { manifest as manifest172 } from "../backend/operations/media-monitoring-disable.sandbox";
import { manifest as manifest173 } from "../backend/operations/media-monitoring-enable.sandbox";
import { manifest as manifest174 } from "../backend/operations/media-monitoring-status.sandbox";
import { manifest as manifest11 } from "../backend/operations/metadata-lookup.sandbox";
import { manifest as manifest12 } from "../backend/operations/resolve-episodes.sandbox";
import { manifest as manifest50 } from "../backend/providers/anime/anilist/details.sandbox";
import { manifest as manifest51 } from "../backend/providers/anime/anilist/search.sandbox";
import { manifest as manifest52 } from "../backend/providers/anime/anilist/translate.sandbox";
import { manifest as manifest53 } from "../backend/providers/anime/myanimelist/details.sandbox";
import { manifest as manifest54 } from "../backend/providers/anime/myanimelist/search.sandbox";
import { manifest as manifest27 } from "../backend/providers/audiobook-group/audible/details.sandbox";
import { manifest as manifest28 } from "../backend/providers/audiobook-group/audible/search.sandbox";
import { manifest as manifest55 } from "../backend/providers/audiobook/audible/details.sandbox";
import { manifest as manifest56 } from "../backend/providers/audiobook/audible/search.sandbox";
import { manifest as manifest31 } from "../backend/providers/book-group/hardcover/details.sandbox";
import { manifest as manifest32 } from "../backend/providers/book-group/hardcover/search.sandbox";
import { manifest as manifest57 } from "../backend/providers/book/google-books/details.sandbox";
import { manifest as manifest58 } from "../backend/providers/book/google-books/resolve.sandbox";
import { manifest as manifest59 } from "../backend/providers/book/google-books/search.sandbox";
import { manifest as manifest60 } from "../backend/providers/book/hardcover/details.sandbox";
import { manifest as manifest61 } from "../backend/providers/book/hardcover/resolve.sandbox";
import { manifest as manifest62 } from "../backend/providers/book/hardcover/search.sandbox";
import { manifest as manifest63 } from "../backend/providers/book/openlibrary/details.sandbox";
import { manifest as manifest64 } from "../backend/providers/book/openlibrary/resolve.sandbox";
import { manifest as manifest65 } from "../backend/providers/book/openlibrary/search.sandbox";
import { manifest as manifest35 } from "../backend/providers/comic-book-group/metron/details.sandbox";
import { manifest as manifest36 } from "../backend/providers/comic-book-group/metron/search.sandbox";
import { manifest as manifest66 } from "../backend/providers/comic-book/metron/details.sandbox";
import { manifest as manifest67 } from "../backend/providers/comic-book/metron/search.sandbox";
import { manifest as manifest13 } from "../backend/providers/company/anilist/details.sandbox";
import { manifest as manifest14 } from "../backend/providers/company/anilist/search.sandbox";
import { manifest as manifest15 } from "../backend/providers/company/giant-bomb/details.sandbox";
import { manifest as manifest16 } from "../backend/providers/company/giant-bomb/search.sandbox";
import { manifest as manifest17 } from "../backend/providers/company/hardcover/details.sandbox";
import { manifest as manifest18 } from "../backend/providers/company/hardcover/search.sandbox";
import { manifest as manifest19 } from "../backend/providers/company/igdb/details.sandbox";
import { manifest as manifest20 } from "../backend/providers/company/igdb/search.sandbox";
import { manifest as manifest21 } from "../backend/providers/company/tmdb/details.sandbox";
import { manifest as manifest22 } from "../backend/providers/company/tmdb/search.sandbox";
import { manifest as manifest23 } from "../backend/providers/company/tvdb/details.sandbox";
import { manifest as manifest24 } from "../backend/providers/company/tvdb/search.sandbox";
import { manifest as manifest68 } from "../backend/providers/manga/anilist/details.sandbox";
import { manifest as manifest69 } from "../backend/providers/manga/anilist/search.sandbox";
import { manifest as manifest70 } from "../backend/providers/manga/anilist/translate.sandbox";
import { manifest as manifest71 } from "../backend/providers/manga/manga-updates/details.sandbox";
import { manifest as manifest72 } from "../backend/providers/manga/manga-updates/search.sandbox";
import { manifest as manifest73 } from "../backend/providers/manga/myanimelist/details.sandbox";
import { manifest as manifest74 } from "../backend/providers/manga/myanimelist/search.sandbox";
import { manifest as manifest41 } from "../backend/providers/movie-group/tmdb/details.sandbox";
import { manifest as manifest42 } from "../backend/providers/movie-group/tmdb/search.sandbox";
import { manifest as manifest43 } from "../backend/providers/movie-group/tmdb/translate.sandbox";
import { manifest as manifest44 } from "../backend/providers/movie-group/tvdb/details.sandbox";
import { manifest as manifest45 } from "../backend/providers/movie-group/tvdb/search.sandbox";
import { manifest as manifest46 } from "../backend/providers/movie-group/tvdb/translate.sandbox";
import { manifest as manifest75 } from "../backend/providers/movie/tmdb/details.sandbox";
import { manifest as manifest76 } from "../backend/providers/movie/tmdb/resolve.sandbox";
import { manifest as manifest77 } from "../backend/providers/movie/tmdb/search.sandbox";
import { manifest as manifest78 } from "../backend/providers/movie/tmdb/translate.sandbox";
import { manifest as manifest134 } from "../backend/providers/movie/tmdb/trending.sandbox";
import { manifest as manifest79 } from "../backend/providers/movie/tvdb/details.sandbox";
import { manifest as manifest80 } from "../backend/providers/movie/tvdb/search.sandbox";
import { manifest as manifest81 } from "../backend/providers/movie/tvdb/translate.sandbox";
import { manifest as manifest37 } from "../backend/providers/music-group/music-brainz/details.sandbox";
import { manifest as manifest38 } from "../backend/providers/music-group/music-brainz/search.sandbox";
import { manifest as manifest39 } from "../backend/providers/music-group/spotify/details.sandbox";
import { manifest as manifest40 } from "../backend/providers/music-group/spotify/search.sandbox";
import { manifest as manifest47 } from "../backend/providers/music-group/youtube-music/details.sandbox";
import { manifest as manifest48 } from "../backend/providers/music-group/youtube-music/search.sandbox";
import { manifest as manifest49 } from "../backend/providers/music-group/youtube-music/translate.sandbox";
import { manifest as manifest82 } from "../backend/providers/music/music-brainz/details.sandbox";
import { manifest as manifest83 } from "../backend/providers/music/music-brainz/search.sandbox";
import { manifest as manifest84 } from "../backend/providers/music/spotify/details.sandbox";
import { manifest as manifest85 } from "../backend/providers/music/spotify/search.sandbox";
import { manifest as manifest86 } from "../backend/providers/music/youtube-music/details.sandbox";
import { manifest as manifest87 } from "../backend/providers/music/youtube-music/history.sandbox";
import { manifest as manifest88 } from "../backend/providers/music/youtube-music/search.sandbox";
import { manifest as manifest89 } from "../backend/providers/music/youtube-music/translate.sandbox";
import { manifest as manifest108 } from "../backend/providers/person/anilist/details.sandbox";
import { manifest as manifest109 } from "../backend/providers/person/anilist/search.sandbox";
import { manifest as manifest110 } from "../backend/providers/person/audible/details.sandbox";
import { manifest as manifest111 } from "../backend/providers/person/audible/search.sandbox";
import { manifest as manifest112 } from "../backend/providers/person/giant-bomb/details.sandbox";
import { manifest as manifest113 } from "../backend/providers/person/giant-bomb/search.sandbox";
import { manifest as manifest114 } from "../backend/providers/person/hardcover/details.sandbox";
import { manifest as manifest115 } from "../backend/providers/person/hardcover/search.sandbox";
import { manifest as manifest116 } from "../backend/providers/person/manga-updates/details.sandbox";
import { manifest as manifest117 } from "../backend/providers/person/manga-updates/search.sandbox";
import { manifest as manifest118 } from "../backend/providers/person/metron/details.sandbox";
import { manifest as manifest119 } from "../backend/providers/person/metron/search.sandbox";
import { manifest as manifest120 } from "../backend/providers/person/music-brainz/details.sandbox";
import { manifest as manifest121 } from "../backend/providers/person/music-brainz/search.sandbox";
import { manifest as manifest122 } from "../backend/providers/person/openlibrary/details.sandbox";
import { manifest as manifest123 } from "../backend/providers/person/spotify/details.sandbox";
import { manifest as manifest124 } from "../backend/providers/person/spotify/search.sandbox";
import { manifest as manifest125 } from "../backend/providers/person/tmdb/details.sandbox";
import { manifest as manifest126 } from "../backend/providers/person/tmdb/search.sandbox";
import { manifest as manifest127 } from "../backend/providers/person/tmdb/translate.sandbox";
import { manifest as manifest128 } from "../backend/providers/person/tvdb/details.sandbox";
import { manifest as manifest129 } from "../backend/providers/person/tvdb/search.sandbox";
import { manifest as manifest130 } from "../backend/providers/person/tvdb/translate.sandbox";
import { manifest as manifest25 } from "../backend/providers/person/vndb/details.sandbox";
import { manifest as manifest26 } from "../backend/providers/person/vndb/search.sandbox";
import { manifest as manifest131 } from "../backend/providers/person/youtube-music/details.sandbox";
import { manifest as manifest132 } from "../backend/providers/person/youtube-music/search.sandbox";
import { manifest as manifest133 } from "../backend/providers/person/youtube-music/translate.sandbox";
import { manifest as manifest90 } from "../backend/providers/podcast/itunes/details.sandbox";
import { manifest as manifest91 } from "../backend/providers/podcast/itunes/search.sandbox";
import { manifest as manifest92 } from "../backend/providers/podcast/itunes/translate.sandbox";
import { manifest as manifest93 } from "../backend/providers/podcast/listennotes/details.sandbox";
import { manifest as manifest94 } from "../backend/providers/podcast/listennotes/search.sandbox";
import { manifest as manifest95 } from "../backend/providers/show/tmdb/details.sandbox";
import { manifest as manifest96 } from "../backend/providers/show/tmdb/resolve.sandbox";
import { manifest as manifest97 } from "../backend/providers/show/tmdb/search.sandbox";
import { manifest as manifest98 } from "../backend/providers/show/tmdb/translate.sandbox";
import { manifest as manifest135 } from "../backend/providers/show/tmdb/trending.sandbox";
import { manifest as manifest99 } from "../backend/providers/show/tvdb/details.sandbox";
import { manifest as manifest100 } from "../backend/providers/show/tvdb/search.sandbox";
import { manifest as manifest101 } from "../backend/providers/show/tvdb/translate.sandbox";
import { manifest as manifest29 } from "../backend/providers/video-game-group/giant-bomb/details.sandbox";
import { manifest as manifest30 } from "../backend/providers/video-game-group/giant-bomb/search.sandbox";
import { manifest as manifest33 } from "../backend/providers/video-game-group/igdb/details.sandbox";
import { manifest as manifest34 } from "../backend/providers/video-game-group/igdb/search.sandbox";
import { manifest as manifest102 } from "../backend/providers/video-game/giant-bomb/details.sandbox";
import { manifest as manifest103 } from "../backend/providers/video-game/giant-bomb/search.sandbox";
import { manifest as manifest104 } from "../backend/providers/video-game/igdb/details.sandbox";
import { manifest as manifest179 } from "../backend/providers/video-game/igdb/search-options.sandbox";
import { manifest as manifest105 } from "../backend/providers/video-game/igdb/search.sandbox";
import { manifest as manifest106 } from "../backend/providers/visual-novel/vndb/details.sandbox";
import { manifest as manifest107 } from "../backend/providers/visual-novel/vndb/search.sandbox";
import { manifest as manifest136 } from "../backend/workflows/media-import-population.sandbox";
import { manifest as manifest137 } from "../backend/workflows/media-import-resolution.sandbox";
import { manifest as manifest175 } from "../backend/workflows/media-monitoring-sweep.sandbox";
import { manifest as manifest176 } from "../backend/workflows/media-monitoring-targets.sandbox";
import { manifest as manifest138 } from "../backend/workflows/resolve-book-google-books.sandbox";
import { manifest as manifest139 } from "../backend/workflows/resolve-book-hardcover.sandbox";
import { manifest as manifest140 } from "../backend/workflows/resolve-book-openlibrary.sandbox";
import { manifest as manifest141 } from "../backend/workflows/resolve-movie-tmdb.sandbox";
import { manifest as manifest142 } from "../backend/workflows/resolve-show-tmdb.sandbox";

type ProviderOperation = "details" | "resolve" | "search" | "search-options" | "translate";

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

const providerResolutionScript = <const Manifest extends SandboxManifest>(
	manifest: Manifest,
	entry: string,
	providerSlug: string,
) => ({ ...directScript(manifest, entry), providerSlug });

export const mediaScripts = [
	directScript(manifest181, "backend/automations/auto-complete-episodic-parent.sandbox.ts"),
	directScript(manifest0, "backend/automations/auto-complete-on-full-progress.sandbox.ts"),
	directScript(manifest182, "backend/automations/episodic-session-policy.sandbox.ts"),
	directScript(manifest1, "backend/automations/integration-progress-policy.sandbox.ts"),
	directScript(manifest178, "backend/automations/library-membership-policy.sandbox.ts"),
	directScript(manifest180, "backend/automations/media-library-membership-on-import.sandbox.ts"),
	directScript(manifest2, "backend/automations/jellyfin-push.sandbox.ts"),
	directScript(manifest3, "backend/automations/media-association.sandbox.ts"),
	directScript(manifest4, "backend/automations/media-entity-updated.sandbox.ts"),
	directScript(manifest5, "backend/automations/media-relationship-sync.sandbox.ts"),
	directScript(manifest6, "backend/automations/media-trending.sandbox.ts"),
	directScript(manifest7, "backend/automations/notification.sandbox.ts"),
	directScript(manifest8, "backend/automations/radarr-push.sandbox.ts"),
	directScript(manifest9, "backend/automations/review-created.sandbox.ts"),
	directScript(manifest10, "backend/automations/sonarr-push.sandbox.ts"),
	directScript(manifest177, "backend/bootstrap/user-bootstrap.sandbox.ts"),
	directScript(manifest153, "backend/imports/watcharr.sandbox.ts"),
	directScript(manifest154, "backend/imports/resolve-episodes.sandbox.ts"),
	directScript(manifest155, "backend/imports/write-chunks.sandbox.ts"),
	directScript(manifest156, "backend/imports/import.sandbox.ts"),
	directScript(manifest157, "backend/imports/anilist.sandbox.ts"),
	directScript(manifest158, "backend/imports/goodreads.sandbox.ts"),
	directScript(manifest159, "backend/imports/grouvee.sandbox.ts"),
	directScript(manifest160, "backend/imports/hardcover.sandbox.ts"),
	directScript(manifest161, "backend/imports/igdb.sandbox.ts"),
	directScript(manifest162, "backend/imports/imdb.sandbox.ts"),
	directScript(manifest163, "backend/imports/storygraph.sandbox.ts"),
	directScript(manifest164, "backend/imports/movary.sandbox.ts"),
	directScript(manifest165, "backend/imports/myanimelist.sandbox.ts"),
	directScript(manifest166, "backend/imports/netflix.sandbox.ts"),
	directScript(manifest167, "backend/imports/audiobookshelf.sandbox.ts"),
	directScript(manifest168, "backend/imports/jellyfin.sandbox.ts"),
	directScript(manifest169, "backend/imports/media-tracker.sandbox.ts"),
	directScript(manifest170, "backend/imports/plex.sandbox.ts"),
	directScript(manifest171, "backend/imports/trakt.sandbox.ts"),
	directScript(manifest11, "backend/operations/metadata-lookup.sandbox.ts"),
	directScript(manifest12, "backend/operations/resolve-episodes.sandbox.ts"),
	directScript(manifest172, "backend/operations/media-monitoring-disable.sandbox.ts"),
	directScript(manifest173, "backend/operations/media-monitoring-enable.sandbox.ts"),
	directScript(manifest174, "backend/operations/media-monitoring-status.sandbox.ts"),
	directScript(manifest143, "backend/integrations/sinks/browser-extension.sandbox.ts"),
	directScript(manifest144, "backend/integrations/sinks/emby.sandbox.ts"),
	directScript(manifest146, "backend/integrations/sinks/jellyfin.sandbox.ts"),
	directScript(manifest147, "backend/integrations/sinks/kodi.sandbox.ts"),
	directScript(manifest148, "backend/integrations/sinks/plex.sandbox.ts"),
	directScript(manifest149, "backend/integrations/yanks/audiobookshelf.sandbox.ts"),
	directScript(manifest150, "backend/integrations/yanks/komga.sandbox.ts"),
	directScript(manifest151, "backend/integrations/yanks/plex.sandbox.ts"),
	directScript(manifest152, "backend/integrations/yanks/youtube-music.sandbox.ts"),
	providerScript(
		manifest13,
		"backend/providers/company/anilist/details.sandbox.ts",
		"company.anilist",
		"details",
	),
	providerScript(
		manifest14,
		"backend/providers/company/anilist/search.sandbox.ts",
		"company.anilist",
		"search",
	),
	providerScript(
		manifest15,
		"backend/providers/company/giant-bomb/details.sandbox.ts",
		"company.giant-bomb",
		"details",
	),
	providerScript(
		manifest16,
		"backend/providers/company/giant-bomb/search.sandbox.ts",
		"company.giant-bomb",
		"search",
	),
	providerScript(
		manifest17,
		"backend/providers/company/hardcover/details.sandbox.ts",
		"company.hardcover",
		"details",
	),
	providerScript(
		manifest18,
		"backend/providers/company/hardcover/search.sandbox.ts",
		"company.hardcover",
		"search",
	),
	providerScript(
		manifest19,
		"backend/providers/company/igdb/details.sandbox.ts",
		"company.igdb",
		"details",
	),
	providerScript(
		manifest20,
		"backend/providers/company/igdb/search.sandbox.ts",
		"company.igdb",
		"search",
	),
	providerScript(
		manifest21,
		"backend/providers/company/tmdb/details.sandbox.ts",
		"company.tmdb",
		"details",
	),
	providerScript(
		manifest22,
		"backend/providers/company/tmdb/search.sandbox.ts",
		"company.tmdb",
		"search",
	),
	providerScript(
		manifest23,
		"backend/providers/company/tvdb/details.sandbox.ts",
		"company.tvdb",
		"details",
	),
	providerScript(
		manifest24,
		"backend/providers/company/tvdb/search.sandbox.ts",
		"company.tvdb",
		"search",
	),
	providerScript(
		manifest25,
		"backend/providers/person/vndb/details.sandbox.ts",
		"person.vndb",
		"details",
	),
	providerScript(
		manifest26,
		"backend/providers/person/vndb/search.sandbox.ts",
		"person.vndb",
		"search",
	),
	providerScript(
		manifest27,
		"backend/providers/audiobook-group/audible/details.sandbox.ts",
		"audiobook-group.audible",
		"details",
	),
	providerScript(
		manifest28,
		"backend/providers/audiobook-group/audible/search.sandbox.ts",
		"audiobook-group.audible",
		"search",
	),
	providerScript(
		manifest29,
		"backend/providers/video-game-group/giant-bomb/details.sandbox.ts",
		"video-game-group.giant-bomb",
		"details",
	),
	providerScript(
		manifest30,
		"backend/providers/video-game-group/giant-bomb/search.sandbox.ts",
		"video-game-group.giant-bomb",
		"search",
	),
	providerScript(
		manifest31,
		"backend/providers/book-group/hardcover/details.sandbox.ts",
		"book-group.hardcover",
		"details",
	),
	providerScript(
		manifest32,
		"backend/providers/book-group/hardcover/search.sandbox.ts",
		"book-group.hardcover",
		"search",
	),
	providerScript(
		manifest33,
		"backend/providers/video-game-group/igdb/details.sandbox.ts",
		"video-game-group.igdb",
		"details",
	),
	providerScript(
		manifest34,
		"backend/providers/video-game-group/igdb/search.sandbox.ts",
		"video-game-group.igdb",
		"search",
	),
	providerScript(
		manifest35,
		"backend/providers/comic-book-group/metron/details.sandbox.ts",
		"comic-book-group.metron",
		"details",
	),
	providerScript(
		manifest36,
		"backend/providers/comic-book-group/metron/search.sandbox.ts",
		"comic-book-group.metron",
		"search",
	),
	providerScript(
		manifest37,
		"backend/providers/music-group/music-brainz/details.sandbox.ts",
		"music-group.music-brainz",
		"details",
	),
	providerScript(
		manifest38,
		"backend/providers/music-group/music-brainz/search.sandbox.ts",
		"music-group.music-brainz",
		"search",
	),
	providerScript(
		manifest39,
		"backend/providers/music-group/spotify/details.sandbox.ts",
		"music-group.spotify",
		"details",
	),
	providerScript(
		manifest40,
		"backend/providers/music-group/spotify/search.sandbox.ts",
		"music-group.spotify",
		"search",
	),
	providerScript(
		manifest41,
		"backend/providers/movie-group/tmdb/details.sandbox.ts",
		"movie-group.tmdb",
		"details",
	),
	providerScript(
		manifest42,
		"backend/providers/movie-group/tmdb/search.sandbox.ts",
		"movie-group.tmdb",
		"search",
	),
	providerScript(
		manifest43,
		"backend/providers/movie-group/tmdb/translate.sandbox.ts",
		"movie-group.tmdb",
		"translate",
	),
	providerScript(
		manifest44,
		"backend/providers/movie-group/tvdb/details.sandbox.ts",
		"movie-group.tvdb",
		"details",
	),
	providerScript(
		manifest45,
		"backend/providers/movie-group/tvdb/search.sandbox.ts",
		"movie-group.tvdb",
		"search",
	),
	providerScript(
		manifest46,
		"backend/providers/movie-group/tvdb/translate.sandbox.ts",
		"movie-group.tvdb",
		"translate",
	),
	providerScript(
		manifest47,
		"backend/providers/music-group/youtube-music/details.sandbox.ts",
		"music-group.youtube-music",
		"details",
	),
	providerScript(
		manifest48,
		"backend/providers/music-group/youtube-music/search.sandbox.ts",
		"music-group.youtube-music",
		"search",
	),
	providerScript(
		manifest49,
		"backend/providers/music-group/youtube-music/translate.sandbox.ts",
		"music-group.youtube-music",
		"translate",
	),
	providerScript(
		manifest50,
		"backend/providers/anime/anilist/details.sandbox.ts",
		"anime.anilist",
		"details",
	),
	providerScript(
		manifest51,
		"backend/providers/anime/anilist/search.sandbox.ts",
		"anime.anilist",
		"search",
	),
	providerScript(
		manifest52,
		"backend/providers/anime/anilist/translate.sandbox.ts",
		"anime.anilist",
		"translate",
	),
	providerScript(
		manifest53,
		"backend/providers/anime/myanimelist/details.sandbox.ts",
		"anime.myanimelist",
		"details",
	),
	providerScript(
		manifest54,
		"backend/providers/anime/myanimelist/search.sandbox.ts",
		"anime.myanimelist",
		"search",
	),
	providerScript(
		manifest55,
		"backend/providers/audiobook/audible/details.sandbox.ts",
		"audiobook.audible",
		"details",
	),
	providerScript(
		manifest56,
		"backend/providers/audiobook/audible/search.sandbox.ts",
		"audiobook.audible",
		"search",
	),
	providerScript(
		manifest57,
		"backend/providers/book/google-books/details.sandbox.ts",
		"book.google-books",
		"details",
	),
	providerScript(
		manifest58,
		"backend/providers/book/google-books/resolve.sandbox.ts",
		"book.google-books",
		"resolve",
	),
	providerScript(
		manifest59,
		"backend/providers/book/google-books/search.sandbox.ts",
		"book.google-books",
		"search",
	),
	providerScript(
		manifest60,
		"backend/providers/book/hardcover/details.sandbox.ts",
		"book.hardcover",
		"details",
	),
	providerScript(
		manifest61,
		"backend/providers/book/hardcover/resolve.sandbox.ts",
		"book.hardcover",
		"resolve",
	),
	providerScript(
		manifest62,
		"backend/providers/book/hardcover/search.sandbox.ts",
		"book.hardcover",
		"search",
	),
	providerScript(
		manifest63,
		"backend/providers/book/openlibrary/details.sandbox.ts",
		"book.openlibrary",
		"details",
	),
	providerScript(
		manifest64,
		"backend/providers/book/openlibrary/resolve.sandbox.ts",
		"book.openlibrary",
		"resolve",
	),
	providerScript(
		manifest65,
		"backend/providers/book/openlibrary/search.sandbox.ts",
		"book.openlibrary",
		"search",
	),
	providerScript(
		manifest66,
		"backend/providers/comic-book/metron/details.sandbox.ts",
		"comic-book.metron",
		"details",
	),
	providerScript(
		manifest67,
		"backend/providers/comic-book/metron/search.sandbox.ts",
		"comic-book.metron",
		"search",
	),
	providerScript(
		manifest68,
		"backend/providers/manga/anilist/details.sandbox.ts",
		"manga.anilist",
		"details",
	),
	providerScript(
		manifest69,
		"backend/providers/manga/anilist/search.sandbox.ts",
		"manga.anilist",
		"search",
	),
	providerScript(
		manifest70,
		"backend/providers/manga/anilist/translate.sandbox.ts",
		"manga.anilist",
		"translate",
	),
	providerScript(
		manifest71,
		"backend/providers/manga/manga-updates/details.sandbox.ts",
		"manga.manga-updates",
		"details",
	),
	providerScript(
		manifest72,
		"backend/providers/manga/manga-updates/search.sandbox.ts",
		"manga.manga-updates",
		"search",
	),
	providerScript(
		manifest73,
		"backend/providers/manga/myanimelist/details.sandbox.ts",
		"manga.myanimelist",
		"details",
	),
	providerScript(
		manifest74,
		"backend/providers/manga/myanimelist/search.sandbox.ts",
		"manga.myanimelist",
		"search",
	),
	providerScript(
		manifest75,
		"backend/providers/movie/tmdb/details.sandbox.ts",
		"movie.tmdb",
		"details",
	),
	providerScript(
		manifest76,
		"backend/providers/movie/tmdb/resolve.sandbox.ts",
		"movie.tmdb",
		"resolve",
	),
	providerScript(
		manifest77,
		"backend/providers/movie/tmdb/search.sandbox.ts",
		"movie.tmdb",
		"search",
	),
	providerScript(
		manifest78,
		"backend/providers/movie/tmdb/translate.sandbox.ts",
		"movie.tmdb",
		"translate",
	),
	{
		...directScript(manifest134, "backend/providers/movie/tmdb/trending.sandbox.ts"),
		providerSlug: "movie.tmdb",
	},
	providerScript(
		manifest79,
		"backend/providers/movie/tvdb/details.sandbox.ts",
		"movie.tvdb",
		"details",
	),
	providerScript(
		manifest80,
		"backend/providers/movie/tvdb/search.sandbox.ts",
		"movie.tvdb",
		"search",
	),
	providerScript(
		manifest81,
		"backend/providers/movie/tvdb/translate.sandbox.ts",
		"movie.tvdb",
		"translate",
	),
	providerScript(
		manifest82,
		"backend/providers/music/music-brainz/details.sandbox.ts",
		"music.music-brainz",
		"details",
	),
	providerScript(
		manifest83,
		"backend/providers/music/music-brainz/search.sandbox.ts",
		"music.music-brainz",
		"search",
	),
	providerScript(
		manifest84,
		"backend/providers/music/spotify/details.sandbox.ts",
		"music.spotify",
		"details",
	),
	providerScript(
		manifest85,
		"backend/providers/music/spotify/search.sandbox.ts",
		"music.spotify",
		"search",
	),
	providerScript(
		manifest86,
		"backend/providers/music/youtube-music/details.sandbox.ts",
		"music.youtube-music",
		"details",
	),
	{
		...directScript(manifest87, "backend/providers/music/youtube-music/history.sandbox.ts"),
		providerSlug: "music.youtube-music",
	},
	providerScript(
		manifest88,
		"backend/providers/music/youtube-music/search.sandbox.ts",
		"music.youtube-music",
		"search",
	),
	providerScript(
		manifest89,
		"backend/providers/music/youtube-music/translate.sandbox.ts",
		"music.youtube-music",
		"translate",
	),
	providerScript(
		manifest90,
		"backend/providers/podcast/itunes/details.sandbox.ts",
		"podcast.itunes",
		"details",
	),
	providerScript(
		manifest91,
		"backend/providers/podcast/itunes/search.sandbox.ts",
		"podcast.itunes",
		"search",
	),
	providerScript(
		manifest92,
		"backend/providers/podcast/itunes/translate.sandbox.ts",
		"podcast.itunes",
		"translate",
	),
	providerScript(
		manifest93,
		"backend/providers/podcast/listennotes/details.sandbox.ts",
		"podcast.listennotes",
		"details",
	),
	providerScript(
		manifest94,
		"backend/providers/podcast/listennotes/search.sandbox.ts",
		"podcast.listennotes",
		"search",
	),
	providerScript(
		manifest95,
		"backend/providers/show/tmdb/details.sandbox.ts",
		"show.tmdb",
		"details",
	),
	providerScript(
		manifest96,
		"backend/providers/show/tmdb/resolve.sandbox.ts",
		"show.tmdb",
		"resolve",
	),
	providerScript(
		manifest97,
		"backend/providers/show/tmdb/search.sandbox.ts",
		"show.tmdb",
		"search",
	),
	providerScript(
		manifest98,
		"backend/providers/show/tmdb/translate.sandbox.ts",
		"show.tmdb",
		"translate",
	),
	{
		...directScript(manifest135, "backend/providers/show/tmdb/trending.sandbox.ts"),
		providerSlug: "show.tmdb",
	},
	providerScript(
		manifest99,
		"backend/providers/show/tvdb/details.sandbox.ts",
		"show.tvdb",
		"details",
	),
	providerScript(
		manifest100,
		"backend/providers/show/tvdb/search.sandbox.ts",
		"show.tvdb",
		"search",
	),
	providerScript(
		manifest101,
		"backend/providers/show/tvdb/translate.sandbox.ts",
		"show.tvdb",
		"translate",
	),
	providerScript(
		manifest102,
		"backend/providers/video-game/giant-bomb/details.sandbox.ts",
		"video-game.giant-bomb",
		"details",
	),
	providerScript(
		manifest103,
		"backend/providers/video-game/giant-bomb/search.sandbox.ts",
		"video-game.giant-bomb",
		"search",
	),
	providerScript(
		manifest104,
		"backend/providers/video-game/igdb/details.sandbox.ts",
		"video-game.igdb",
		"details",
	),
	providerScript(
		manifest105,
		"backend/providers/video-game/igdb/search.sandbox.ts",
		"video-game.igdb",
		"search",
	),
	providerScript(
		manifest179,
		"backend/providers/video-game/igdb/search-options.sandbox.ts",
		"video-game.igdb",
		"search-options",
	),
	providerScript(
		manifest106,
		"backend/providers/visual-novel/vndb/details.sandbox.ts",
		"visual-novel.vndb",
		"details",
	),
	providerScript(
		manifest107,
		"backend/providers/visual-novel/vndb/search.sandbox.ts",
		"visual-novel.vndb",
		"search",
	),
	providerScript(
		manifest108,
		"backend/providers/person/anilist/details.sandbox.ts",
		"person.anilist",
		"details",
	),
	providerScript(
		manifest109,
		"backend/providers/person/anilist/search.sandbox.ts",
		"person.anilist",
		"search",
	),
	providerScript(
		manifest110,
		"backend/providers/person/audible/details.sandbox.ts",
		"person.audible",
		"details",
	),
	providerScript(
		manifest111,
		"backend/providers/person/audible/search.sandbox.ts",
		"person.audible",
		"search",
	),
	providerScript(
		manifest112,
		"backend/providers/person/giant-bomb/details.sandbox.ts",
		"person.giant-bomb",
		"details",
	),
	providerScript(
		manifest113,
		"backend/providers/person/giant-bomb/search.sandbox.ts",
		"person.giant-bomb",
		"search",
	),
	providerScript(
		manifest114,
		"backend/providers/person/hardcover/details.sandbox.ts",
		"person.hardcover",
		"details",
	),
	providerScript(
		manifest115,
		"backend/providers/person/hardcover/search.sandbox.ts",
		"person.hardcover",
		"search",
	),
	providerScript(
		manifest116,
		"backend/providers/person/manga-updates/details.sandbox.ts",
		"person.manga-updates",
		"details",
	),
	providerScript(
		manifest117,
		"backend/providers/person/manga-updates/search.sandbox.ts",
		"person.manga-updates",
		"search",
	),
	providerScript(
		manifest118,
		"backend/providers/person/metron/details.sandbox.ts",
		"person.metron",
		"details",
	),
	providerScript(
		manifest119,
		"backend/providers/person/metron/search.sandbox.ts",
		"person.metron",
		"search",
	),
	providerScript(
		manifest120,
		"backend/providers/person/music-brainz/details.sandbox.ts",
		"person.music-brainz",
		"details",
	),
	providerScript(
		manifest121,
		"backend/providers/person/music-brainz/search.sandbox.ts",
		"person.music-brainz",
		"search",
	),
	providerScript(
		manifest122,
		"backend/providers/person/openlibrary/details.sandbox.ts",
		"person.openlibrary",
		"details",
	),
	providerScript(
		manifest123,
		"backend/providers/person/spotify/details.sandbox.ts",
		"person.spotify",
		"details",
	),
	providerScript(
		manifest124,
		"backend/providers/person/spotify/search.sandbox.ts",
		"person.spotify",
		"search",
	),
	providerScript(
		manifest125,
		"backend/providers/person/tmdb/details.sandbox.ts",
		"person.tmdb",
		"details",
	),
	providerScript(
		manifest126,
		"backend/providers/person/tmdb/search.sandbox.ts",
		"person.tmdb",
		"search",
	),
	providerScript(
		manifest127,
		"backend/providers/person/tmdb/translate.sandbox.ts",
		"person.tmdb",
		"translate",
	),
	providerScript(
		manifest128,
		"backend/providers/person/tvdb/details.sandbox.ts",
		"person.tvdb",
		"details",
	),
	providerScript(
		manifest129,
		"backend/providers/person/tvdb/search.sandbox.ts",
		"person.tvdb",
		"search",
	),
	providerScript(
		manifest130,
		"backend/providers/person/tvdb/translate.sandbox.ts",
		"person.tvdb",
		"translate",
	),
	providerScript(
		manifest131,
		"backend/providers/person/youtube-music/details.sandbox.ts",
		"person.youtube-music",
		"details",
	),
	providerScript(
		manifest132,
		"backend/providers/person/youtube-music/search.sandbox.ts",
		"person.youtube-music",
		"search",
	),
	providerScript(
		manifest133,
		"backend/providers/person/youtube-music/translate.sandbox.ts",
		"person.youtube-music",
		"translate",
	),
	directScript(manifest136, "backend/workflows/media-import-population.sandbox.ts"),
	directScript(manifest137, "backend/workflows/media-import-resolution.sandbox.ts"),
	directScript(manifest175, "backend/workflows/media-monitoring-sweep.sandbox.ts"),
	directScript(manifest176, "backend/workflows/media-monitoring-targets.sandbox.ts"),
	providerResolutionScript(
		manifest138,
		"backend/workflows/resolve-book-google-books.sandbox.ts",
		"book.google-books",
	),
	providerResolutionScript(
		manifest139,
		"backend/workflows/resolve-book-hardcover.sandbox.ts",
		"book.hardcover",
	),
	providerResolutionScript(
		manifest140,
		"backend/workflows/resolve-book-openlibrary.sandbox.ts",
		"book.openlibrary",
	),
	providerResolutionScript(
		manifest141,
		"backend/workflows/resolve-movie-tmdb.sandbox.ts",
		"movie.tmdb",
	),
	providerResolutionScript(
		manifest142,
		"backend/workflows/resolve-show-tmdb.sandbox.ts",
		"show.tmdb",
	),
] as const;
