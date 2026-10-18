import type { builtinMediaEntitySchemaSlugs } from "./media-schema-slugs";

export const CONSUMED_ON_ITEM_LIMIT = 100;

export const CONSUMED_ON_LIST_LIMIT = 30;

export const consumedOnSettingKeys = {
	book: "consumedOnBook",
	show: "consumedOnShow",
	anime: "consumedOnAnime",
	movie: "consumedOnMovie",
	manga: "consumedOnManga",
	music: "consumedOnMusic",
	podcast: "consumedOnPodcast",
	audiobook: "consumedOnAudiobook",
	"video-game": "consumedOnVideoGame",
	"comic-book": "consumedOnComicBook",
	"visual-novel": "consumedOnVisualNovel",
} as const satisfies Record<(typeof builtinMediaEntitySchemaSlugs)[number], string>;

export type ConsumedOnSettingKey =
	(typeof consumedOnSettingKeys)[keyof typeof consumedOnSettingKeys];

export const consumedOnSettingKey = (schemaSlug: string): undefined | ConsumedOnSettingKey =>
	Object.entries(consumedOnSettingKeys).find(([slug]) => slug === schemaSlug)?.[1];
