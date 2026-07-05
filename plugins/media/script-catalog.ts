import { manifest as manifest0 } from "./scripts/automations/auto-complete-on-full-progress.sandbox";
import { manifest as manifest1 } from "./scripts/automations/integration-progress-policy.sandbox";
import { manifest as manifest2 } from "./scripts/automations/jellyfin-push.sandbox";
import { manifest as manifest3 } from "./scripts/automations/media-association.sandbox";
import { manifest as manifest4 } from "./scripts/automations/media-entity-updated.sandbox";
import { manifest as manifest5 } from "./scripts/automations/media-relationship-sync.sandbox";
import { manifest as manifest61 } from "./scripts/automations/media-trending.sandbox";
import { manifest as manifest60 } from "./scripts/automations/notification.sandbox";
import { manifest as manifest6 } from "./scripts/automations/radarr-push.sandbox";
import { manifest as manifest7 } from "./scripts/automations/review-created.sandbox";
import { manifest as manifest8 } from "./scripts/automations/sonarr-push.sandbox";
import { manifest as manifest62 } from "./scripts/operations/metadata-lookup.sandbox";
import { manifest as manifest63 } from "./scripts/operations/resolve-episodes.sandbox";
import { manifest as manifest9 } from "./scripts/providers/company/anilist.sandbox";
import { manifest as manifest10 } from "./scripts/providers/company/giant-bomb.sandbox";
import { manifest as manifest11 } from "./scripts/providers/company/hardcover.sandbox";
import { manifest as manifest12 } from "./scripts/providers/company/igdb.sandbox";
import { manifest as manifest13 } from "./scripts/providers/company/tmdb.sandbox";
import { manifest as manifest14 } from "./scripts/providers/company/tvdb.sandbox";
import { manifest as manifest15 } from "./scripts/providers/company/vndb.sandbox";
import { manifest as manifest16 } from "./scripts/providers/media-group/audible.sandbox";
import { manifest as manifest17 } from "./scripts/providers/media-group/giant-bomb.sandbox";
import { manifest as manifest18 } from "./scripts/providers/media-group/hardcover.sandbox";
import { manifest as manifest19 } from "./scripts/providers/media-group/igdb.sandbox";
import { manifest as manifest20 } from "./scripts/providers/media-group/metron.sandbox";
import { manifest as manifest21 } from "./scripts/providers/media-group/music-brainz.sandbox";
import { manifest as manifest22 } from "./scripts/providers/media-group/spotify.sandbox";
import { manifest as manifest23 } from "./scripts/providers/media-group/tmdb.sandbox";
import { manifest as manifest24 } from "./scripts/providers/media-group/tvdb.sandbox";
import { manifest as manifest25 } from "./scripts/providers/media-group/youtube-music.sandbox";
import { manifest as manifest26 } from "./scripts/providers/media/anime/anilist.sandbox";
import { manifest as manifest27 } from "./scripts/providers/media/anime/myanimelist.sandbox";
import { manifest as manifest28 } from "./scripts/providers/media/audiobook/audible.sandbox";
import { manifest as manifest29 } from "./scripts/providers/media/book/google-books.sandbox";
import { manifest as manifest30 } from "./scripts/providers/media/book/hardcover.sandbox";
import { manifest as manifest31 } from "./scripts/providers/media/book/openlibrary.sandbox";
import { manifest as manifest32 } from "./scripts/providers/media/comic-book/metron.sandbox";
import { manifest as manifest33 } from "./scripts/providers/media/manga/anilist.sandbox";
import { manifest as manifest34 } from "./scripts/providers/media/manga/manga-updates.sandbox";
import { manifest as manifest35 } from "./scripts/providers/media/manga/myanimelist.sandbox";
import { manifest as manifest36 } from "./scripts/providers/media/movie/tmdb.sandbox";
import { manifest as manifest37 } from "./scripts/providers/media/movie/tvdb.sandbox";
import { manifest as manifest38 } from "./scripts/providers/media/music/music-brainz.sandbox";
import { manifest as manifest39 } from "./scripts/providers/media/music/spotify.sandbox";
import { manifest as manifest40 } from "./scripts/providers/media/music/youtube-music.sandbox";
import { manifest as manifest41 } from "./scripts/providers/media/podcast/itunes.sandbox";
import { manifest as manifest42 } from "./scripts/providers/media/podcast/listennotes.sandbox";
import { manifest as manifest43 } from "./scripts/providers/media/show/tmdb.sandbox";
import { manifest as manifest44 } from "./scripts/providers/media/show/tvdb.sandbox";
import { manifest as manifest45 } from "./scripts/providers/media/video-game/giant-bomb.sandbox";
import { manifest as manifest46 } from "./scripts/providers/media/video-game/igdb.sandbox";
import { manifest as manifest47 } from "./scripts/providers/media/visual-novel/vndb.sandbox";
import { manifest as manifest48 } from "./scripts/providers/person/anilist.sandbox";
import { manifest as manifest49 } from "./scripts/providers/person/audible.sandbox";
import { manifest as manifest50 } from "./scripts/providers/person/giant-bomb.sandbox";
import { manifest as manifest51 } from "./scripts/providers/person/hardcover.sandbox";
import { manifest as manifest52 } from "./scripts/providers/person/manga-updates.sandbox";
import { manifest as manifest53 } from "./scripts/providers/person/metron.sandbox";
import { manifest as manifest54 } from "./scripts/providers/person/music-brainz.sandbox";
import { manifest as manifest55 } from "./scripts/providers/person/openlibrary.sandbox";
import { manifest as manifest56 } from "./scripts/providers/person/spotify.sandbox";
import { manifest as manifest57 } from "./scripts/providers/person/tmdb.sandbox";
import { manifest as manifest58 } from "./scripts/providers/person/tvdb.sandbox";
import { manifest as manifest59 } from "./scripts/providers/person/youtube-music.sandbox";

export const mediaScripts = [
	{ ...manifest0, entry: "scripts/automations/auto-complete-on-full-progress.sandbox.ts" },
	{ ...manifest1, entry: "scripts/automations/integration-progress-policy.sandbox.ts" },
	{ ...manifest2, entry: "scripts/automations/jellyfin-push.sandbox.ts" },
	{ ...manifest3, entry: "scripts/automations/media-association.sandbox.ts" },
	{ ...manifest4, entry: "scripts/automations/media-entity-updated.sandbox.ts" },
	{ ...manifest5, entry: "scripts/automations/media-relationship-sync.sandbox.ts" },
	{ ...manifest61, entry: "scripts/automations/media-trending.sandbox.ts" },
	{ ...manifest60, entry: "scripts/automations/notification.sandbox.ts" },
	{ ...manifest6, entry: "scripts/automations/radarr-push.sandbox.ts" },
	{ ...manifest7, entry: "scripts/automations/review-created.sandbox.ts" },
	{ ...manifest8, entry: "scripts/automations/sonarr-push.sandbox.ts" },
	{ ...manifest62, entry: "scripts/operations/metadata-lookup.sandbox.ts" },
	{ ...manifest63, entry: "scripts/operations/resolve-episodes.sandbox.ts" },
	{ ...manifest9, entry: "scripts/providers/company/anilist.sandbox.ts" },
	{ ...manifest10, entry: "scripts/providers/company/giant-bomb.sandbox.ts" },
	{ ...manifest11, entry: "scripts/providers/company/hardcover.sandbox.ts" },
	{ ...manifest12, entry: "scripts/providers/company/igdb.sandbox.ts" },
	{ ...manifest13, entry: "scripts/providers/company/tmdb.sandbox.ts" },
	{ ...manifest14, entry: "scripts/providers/company/tvdb.sandbox.ts" },
	{ ...manifest15, entry: "scripts/providers/company/vndb.sandbox.ts" },
	{ ...manifest16, entry: "scripts/providers/media-group/audible.sandbox.ts" },
	{ ...manifest17, entry: "scripts/providers/media-group/giant-bomb.sandbox.ts" },
	{ ...manifest18, entry: "scripts/providers/media-group/hardcover.sandbox.ts" },
	{ ...manifest19, entry: "scripts/providers/media-group/igdb.sandbox.ts" },
	{ ...manifest20, entry: "scripts/providers/media-group/metron.sandbox.ts" },
	{ ...manifest21, entry: "scripts/providers/media-group/music-brainz.sandbox.ts" },
	{ ...manifest22, entry: "scripts/providers/media-group/spotify.sandbox.ts" },
	{ ...manifest23, entry: "scripts/providers/media-group/tmdb.sandbox.ts" },
	{ ...manifest24, entry: "scripts/providers/media-group/tvdb.sandbox.ts" },
	{ ...manifest25, entry: "scripts/providers/media-group/youtube-music.sandbox.ts" },
	{ ...manifest26, entry: "scripts/providers/media/anime/anilist.sandbox.ts" },
	{ ...manifest27, entry: "scripts/providers/media/anime/myanimelist.sandbox.ts" },
	{ ...manifest28, entry: "scripts/providers/media/audiobook/audible.sandbox.ts" },
	{ ...manifest29, entry: "scripts/providers/media/book/google-books.sandbox.ts" },
	{ ...manifest30, entry: "scripts/providers/media/book/hardcover.sandbox.ts" },
	{ ...manifest31, entry: "scripts/providers/media/book/openlibrary.sandbox.ts" },
	{ ...manifest32, entry: "scripts/providers/media/comic-book/metron.sandbox.ts" },
	{ ...manifest33, entry: "scripts/providers/media/manga/anilist.sandbox.ts" },
	{ ...manifest34, entry: "scripts/providers/media/manga/manga-updates.sandbox.ts" },
	{ ...manifest35, entry: "scripts/providers/media/manga/myanimelist.sandbox.ts" },
	{ ...manifest36, entry: "scripts/providers/media/movie/tmdb.sandbox.ts" },
	{ ...manifest37, entry: "scripts/providers/media/movie/tvdb.sandbox.ts" },
	{ ...manifest38, entry: "scripts/providers/media/music/music-brainz.sandbox.ts" },
	{ ...manifest39, entry: "scripts/providers/media/music/spotify.sandbox.ts" },
	{ ...manifest40, entry: "scripts/providers/media/music/youtube-music.sandbox.ts" },
	{ ...manifest41, entry: "scripts/providers/media/podcast/itunes.sandbox.ts" },
	{ ...manifest42, entry: "scripts/providers/media/podcast/listennotes.sandbox.ts" },
	{ ...manifest43, entry: "scripts/providers/media/show/tmdb.sandbox.ts" },
	{ ...manifest44, entry: "scripts/providers/media/show/tvdb.sandbox.ts" },
	{ ...manifest45, entry: "scripts/providers/media/video-game/giant-bomb.sandbox.ts" },
	{ ...manifest46, entry: "scripts/providers/media/video-game/igdb.sandbox.ts" },
	{ ...manifest47, entry: "scripts/providers/media/visual-novel/vndb.sandbox.ts" },
	{ ...manifest48, entry: "scripts/providers/person/anilist.sandbox.ts" },
	{ ...manifest49, entry: "scripts/providers/person/audible.sandbox.ts" },
	{ ...manifest50, entry: "scripts/providers/person/giant-bomb.sandbox.ts" },
	{ ...manifest51, entry: "scripts/providers/person/hardcover.sandbox.ts" },
	{ ...manifest52, entry: "scripts/providers/person/manga-updates.sandbox.ts" },
	{ ...manifest53, entry: "scripts/providers/person/metron.sandbox.ts" },
	{ ...manifest54, entry: "scripts/providers/person/music-brainz.sandbox.ts" },
	{ ...manifest55, entry: "scripts/providers/person/openlibrary.sandbox.ts" },
	{ ...manifest56, entry: "scripts/providers/person/spotify.sandbox.ts" },
	{ ...manifest57, entry: "scripts/providers/person/tmdb.sandbox.ts" },
	{ ...manifest58, entry: "scripts/providers/person/tvdb.sandbox.ts" },
	{ ...manifest59, entry: "scripts/providers/person/youtube-music.sandbox.ts" },
] as const;
