import type { PreparedRecipe } from "@ryot-app/client-sdk/ryotql";
import { Result } from "@ryot-app/plugin-kit/effect";

import { rowsResult } from "../query-result-fixture";

export const includeResult = (items: readonly unknown[]) => ({
	items,
	pageInfo: { hasMore: false, limit: items.length },
});

export const rows = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 20, hasMore: false, nextCursor: null });

export const mediaIdentity = (id: string, name: string, schemaSlug: string) => ({
	id,
	name,
	schemaSlug,
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "remote", purpose: "cover", url: `https://images.test/${id}.jpg` }],
});

export const flatRow = (
	id: string,
	name: string,
	schemaSlug: string,
	fields: {
		readonly latestActivityAt: string;
		readonly mangaVolume?: number;
		readonly animeEpisode?: number;
		readonly mangaChapter?: number;
		readonly progressPercent?: number;
	},
) => ({
	...mediaIdentity(id, name, schemaSlug),
	state: "in_progress",
	mangaVolume: fields.mangaVolume ?? null,
	animeEpisode: fields.animeEpisode ?? null,
	mangaChapter: fields.mangaChapter ?? null,
	latestActivityAt: fields.latestActivityAt,
	progressPercent: fields.progressPercent ?? null,
});

export const nextUpRow = (seasonNumber: number | null, episodeNumber: number, name: string) => ({
	...mediaIdentity(`episode-${episodeNumber}`, name, "show-episode"),
	name,
	seasonNumber,
	runtime: null,
	episodeNumber,
	description: null,
	publishDate: null,
	state: "untracked",
});

export const episodicRow = (
	id: string,
	name: string,
	schemaSlug: "show" | "podcast",
	latestActivityAt: string,
	nextUp: ReturnType<typeof nextUpRow> | null,
) => ({
	...mediaIdentity(id, name, schemaSlug),
	latestActivityAt,
	state: "in_progress",
	nextUp: includeResult(nextUp === null ? [] : [nextUp]),
});

/** Decodes a wire response through the recipe the section query runs. */
export const decodeRecipe = <Success>(
	recipe: PreparedRecipe<Success>,
	data: Readonly<Record<string, unknown>>,
) => Result.getOrThrow(recipe.decode({ data }));
