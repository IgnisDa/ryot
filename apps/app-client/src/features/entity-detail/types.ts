import type { AnimeProperties } from "@ryot/app-backend-legacy/lib/media/anime";
import type { AudiobookProperties } from "@ryot/app-backend-legacy/lib/media/audiobook";
import type { BookProperties } from "@ryot/app-backend-legacy/lib/media/book";
import type { ComicBookProperties } from "@ryot/app-backend-legacy/lib/media/comic-book";
import type { UnlinkedCreator as BackendUnlinkedCreator } from "@ryot/app-backend-legacy/lib/media/common";
import type { MangaProperties } from "@ryot/app-backend-legacy/lib/media/manga";
import type { MovieProperties } from "@ryot/app-backend-legacy/lib/media/movie";
import type { MusicProperties } from "@ryot/app-backend-legacy/lib/media/music";
import type { PodcastProperties } from "@ryot/app-backend-legacy/lib/media/podcast";
import type { ShowProperties } from "@ryot/app-backend-legacy/lib/media/show";
import type { VideoGameProperties } from "@ryot/app-backend-legacy/lib/media/video-game";
import type { VisualNovelProperties } from "@ryot/app-backend-legacy/lib/media/visual-novel";
import type { paths } from "@ryot/generated/openapi/app-backend";

import type { EntityImage } from "@/lib/entity-image";

import type { MediaScopeSlug } from "../media/constants";

export type UnlinkedCreator = BackendUnlinkedCreator & { id?: string; image?: EntityImage };

export type EntityResponse =
	paths["/entities/{entityId}"]["get"]["responses"][200]["content"]["application/json"]["data"];

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
