import type {
	AnimeProperties,
	AudiobookProperties,
	BookProperties,
	ComicBookProperties,
	MovieProperties,
	MangaProperties,
	MusicProperties,
	PodcastProperties,
	ShowProperties,
	UnlinkedCreator,
	VideoGameProperties,
	VisualNovelProperties,
} from "@ryot/app-backend/schema/media-types";

import type { ContractClient, ContractSuccess } from "@/lib/contract-client";
import type { EntityImage } from "@/lib/entity-image";

import type { MediaScopeSlug } from "../media/constants";

export type AppUnlinkedCreator = UnlinkedCreator & { id?: string; image?: EntityImage };

export type EntityResponse = ContractSuccess<ContractClient["entities"]["get"]>;

type EntityBase = Omit<EntityResponse, "image" | "properties"> & {
	image: EntityImage;
};

export type SupportedEntitySchemaSlug = Exclude<MediaScopeSlug, "person">;

type EntityDetailBase<TSlug extends SupportedEntitySchemaSlug, TProperties> = EntityBase & {
	properties: TProperties;
	entitySchemaSlug: TSlug;
};

export type BookDetail = EntityDetailBase<"book", BookProperties>;

export type MovieDetail = EntityDetailBase<"movie", MovieProperties>;

export type ShowDetail = EntityDetailBase<"show", ShowProperties>;

export type AnimeDetail = EntityDetailBase<"anime", AnimeProperties>;

export type MangaDetail = EntityDetailBase<"manga", MangaProperties>;

export type ComicBookDetail = EntityDetailBase<"comic-book", ComicBookProperties>;

export type AudiobookDetail = EntityDetailBase<"audiobook", AudiobookProperties>;

export type PodcastDetail = EntityDetailBase<"podcast", PodcastProperties>;

export type MusicDetail = EntityDetailBase<"music", MusicProperties>;

export type VideoGameDetail = EntityDetailBase<"video-game", VideoGameProperties>;

export type VisualNovelDetail = EntityDetailBase<"visual-novel", VisualNovelProperties>;

export type EntityDetail =
	| BookDetail
	| ShowDetail
	| MovieDetail
	| MusicDetail
	| AnimeDetail
	| MangaDetail
	| PodcastDetail
	| ComicBookDetail
	| AudiobookDetail
	| VideoGameDetail
	| VisualNovelDetail;
