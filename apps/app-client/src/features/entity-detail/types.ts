import type { EntityImage } from "@/lib/image";

export type { EntityImage };

export type FreeCreator = { name: string; role: string; image?: string };

type CommonBase = {
	id: string;
	name: string;
	genres: string[];
	images: EntityImage[];
	isNsfw: boolean | null;
	sourceUrl: string | null;
	description: string | null;
	publishYear: number | null;
	providerRating: number | null;
	productionStatus: string | null;
	collections: string[] | null;
};

export type BookDetail = CommonBase & {
	entitySchemaSlug: "book";
	pages: number | null;
	freeCreators: FreeCreator[];
	isCompilation: boolean | null;
};

export type MovieDetail = CommonBase & {
	entitySchemaSlug: "movie";
	runtime: number | null;
	freeCreators: FreeCreator[];
};

export type ShowEpisode = {
	id: number;
	name: string;
	runtime: number | null;
	overview: string | null;
	episodeNumber: number;
};

export type ShowSeason = {
	id: number;
	name: string;
	publishDate: string | null;
	seasonNumber: number;
	episodes: ShowEpisode[];
};

export type ShowDetail = CommonBase & {
	entitySchemaSlug: "show";
	showSeasons: ShowSeason[];
	freeCreators: FreeCreator[];
};

export type AnimeDetail = CommonBase & {
	entitySchemaSlug: "anime";
	episodes: number | null;
	airingSchedule: Array<{ episode: number; airingAt: string }> | null;
};

export type MangaDetail = CommonBase & {
	entitySchemaSlug: "manga";
	volumes: number | null;
	chapters: number | null;
};

export type ComicBookDetail = CommonBase & {
	entitySchemaSlug: "comic-book";
	pages: number | null;
};

export type AudiobookDetail = CommonBase & {
	entitySchemaSlug: "audiobook";
	runtime: number | null;
	freeCreators: FreeCreator[];
};

export type PodcastEpisode = {
	id: string;
	title: string;
	number: number;
	publishDate: string;
	runtime: number | null;
	overview: string | null;
};

export type PodcastDetail = CommonBase & {
	entitySchemaSlug: "podcast";
	episodes: PodcastEpisode[];
	freeCreators: FreeCreator[];
	totalEpisodes: number | null;
};

export type MusicDetail = CommonBase & {
	entitySchemaSlug: "music";
	duration: number | null;
	byVariousArtists: boolean | null;
};

export type VideoGameDetail = CommonBase & {
	entitySchemaSlug: "video-game";
	timeToBeat: {
		hastily: number | null;
		normally: number | null;
		completely: number | null;
	} | null;
	platformReleases: Array<{ name: string; releaseDate: string | null }> | null;
};

export type VisualNovelDetail = CommonBase & {
	entitySchemaSlug: "visual-novel";
	lengthMinutes: number | null;
};

export type EntityDetail =
	| BookDetail
	| MovieDetail
	| ShowDetail
	| AnimeDetail
	| MangaDetail
	| ComicBookDetail
	| AudiobookDetail
	| PodcastDetail
	| MusicDetail
	| VideoGameDetail
	| VisualNovelDetail;

export type EntitySchemaSlug = EntityDetail["entitySchemaSlug"];
