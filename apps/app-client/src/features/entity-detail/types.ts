import type { EntityImage } from "@/lib/entity-image";

export type UnlinkedCreator = { id?: string; name: string; role: string; image?: string };

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
	unlinkedCreators: UnlinkedCreator[];
};

export type BookDetail = CommonBase & {
	pages: number | null;
	entitySchemaSlug: "book";
	isCompilation: boolean | null;
};

export type MovieDetail = CommonBase & {
	runtime: number | null;
	entitySchemaSlug: "movie";
};

export type ShowEpisode = {
	id: number;
	name: string;
	episodeNumber: number;
	runtime: number | null;
	overview: string | null;
};

export type ShowSeason = {
	id: number;
	name: string;
	seasonNumber: number;
	episodes: ShowEpisode[];
	publishDate: string | null;
};

export type ShowDetail = CommonBase & {
	entitySchemaSlug: "show";
	showSeasons: ShowSeason[];
};

export type AnimeDetail = CommonBase & {
	episodes: number | null;
	entitySchemaSlug: "anime";
	airingSchedule: Array<{ episode: number; airingAt: string }> | null;
};

export type MangaDetail = CommonBase & {
	volumes: number | null;
	chapters: number | null;
	entitySchemaSlug: "manga";
};

export type ComicBookDetail = CommonBase & {
	pages: number | null;
	entitySchemaSlug: "comic-book";
};

export type AudiobookDetail = CommonBase & {
	runtime: number | null;
	entitySchemaSlug: "audiobook";
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
	episodes: PodcastEpisode[];
	entitySchemaSlug: "podcast";
	totalEpisodes: number | null;
};

export type MusicDetail = CommonBase & {
	duration: number | null;
	entitySchemaSlug: "music";
	byVariousArtists: boolean | null;
};

export type VideoGameDetail = CommonBase & {
	entitySchemaSlug: "video-game";
	platformReleases: Array<{ name: string; releaseDate: string | null }> | null;
	timeToBeat: {
		hastily: number | null;
		normally: number | null;
		completely: number | null;
	} | null;
};

export type VisualNovelDetail = CommonBase & {
	lengthMinutes: number | null;
	entitySchemaSlug: "visual-novel";
};

export type EntityDetail =
	| BookDetail
	| ShowDetail
	| MovieDetail
	| AnimeDetail
	| MangaDetail
	| MusicDetail
	| PodcastDetail
	| ComicBookDetail
	| AudiobookDetail
	| VideoGameDetail
	| VisualNovelDetail;
