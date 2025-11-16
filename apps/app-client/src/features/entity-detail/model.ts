import {
	AnimePropertiesSchema,
	AudiobookPropertiesSchema,
	BookPropertiesSchema,
	ComicBookPropertiesSchema,
	MangaPropertiesSchema,
	MoviePropertiesSchema,
	MusicPropertiesSchema,
	PodcastPropertiesSchema,
	ShowPropertiesSchema,
	VideoGamePropertiesSchema,
	VisualNovelPropertiesSchema,
} from "@ryot/app-backend/schema/media-types";
import { Schema } from "effect";
import { match } from "ts-pattern";

import { toEntityImage } from "@/lib/entity-image";

import { MEDIA_SCOPE_SLUGS } from "../media/constants";
import type { EntityDetail, EntityResponse, SupportedEntitySchemaSlug } from "./types";

const SUPPORTED_ENTITY_SCHEMA_SLUGS = MEDIA_SCOPE_SLUGS.filter(
	(slug): slug is SupportedEntitySchemaSlug => slug !== "person",
);

export function isEntitySchemaSlug(value: string): value is SupportedEntitySchemaSlug {
	return SUPPORTED_ENTITY_SCHEMA_SLUGS.some((slug) => slug === value);
}

export function toEntityDetail<TSlug extends SupportedEntitySchemaSlug>(
	entity: EntityResponse,
	entitySchemaSlug: TSlug,
): Extract<EntityDetail, { entitySchemaSlug: TSlug }>;

export function toEntityDetail(
	entity: EntityResponse,
	entitySchemaSlug: SupportedEntitySchemaSlug,
) {
	const { properties, ...rest } = entity;
	const base = { ...rest, image: toEntityImage(entity.image) };

	return match(entitySchemaSlug)
		.with("book", (slug) => ({
			...base,
			entitySchemaSlug: slug,
			properties: Schema.decodeUnknownSync(BookPropertiesSchema)(properties),
		}))
		.with("show", (slug) => ({
			...base,
			entitySchemaSlug: slug,
			properties: Schema.decodeUnknownSync(ShowPropertiesSchema)(properties),
		}))
		.with("anime", (slug) => ({
			...base,
			entitySchemaSlug: slug,
			properties: Schema.decodeUnknownSync(AnimePropertiesSchema)(properties),
		}))
		.with("manga", (slug) => ({
			...base,
			entitySchemaSlug: slug,
			properties: Schema.decodeUnknownSync(MangaPropertiesSchema)(properties),
		}))
		.with("music", (slug) => ({
			...base,
			entitySchemaSlug: slug,
			properties: Schema.decodeUnknownSync(MusicPropertiesSchema)(properties),
		}))
		.with("movie", (slug) => ({
			...base,
			entitySchemaSlug: slug,
			properties: Schema.decodeUnknownSync(MoviePropertiesSchema)(properties),
		}))
		.with("podcast", (slug) => ({
			...base,
			entitySchemaSlug: slug,
			properties: Schema.decodeUnknownSync(PodcastPropertiesSchema)(properties),
		}))
		.with("audiobook", (slug) => ({
			...base,
			entitySchemaSlug: slug,
			properties: Schema.decodeUnknownSync(AudiobookPropertiesSchema)(properties),
		}))
		.with("comic-book", (slug) => ({
			...base,
			entitySchemaSlug: slug,
			properties: Schema.decodeUnknownSync(ComicBookPropertiesSchema)(properties),
		}))
		.with("video-game", (slug) => ({
			...base,
			entitySchemaSlug: slug,
			properties: Schema.decodeUnknownSync(VideoGamePropertiesSchema)(properties),
		}))
		.with("visual-novel", (slug) => ({
			...base,
			entitySchemaSlug: slug,
			properties: Schema.decodeUnknownSync(VisualNovelPropertiesSchema)(properties),
		}))
		.exhaustive();
}
