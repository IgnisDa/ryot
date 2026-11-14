import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";
import { Result } from "@ryot-app/plugin-kit/effect";

import type { MediaPosition } from "../../../shared/consumption";
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
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
	images: [{ type: "remote", purpose: "cover", url: `https://images.test/${id}.jpg` }],
});

export const flatRow = (
	id: string,
	name: string,
	schemaSlug: string,
	fields: {
		readonly position?: MediaPosition;
		readonly latestActivityAt: string;
		readonly progressPercent?: number;
	},
) => ({
	...mediaIdentity(id, name, schemaSlug),
	state: "in_progress",
	position: fields.position ?? null,
	latestActivityAt: fields.latestActivityAt,
	progressPercent: fields.progressPercent ?? null,
});

export const nextUpRow = (seasonNumber: null | number, episodeNumber: number, name: string) => ({
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
	nextUp: null | ReturnType<typeof nextUpRow>,
) => ({
	...mediaIdentity(id, name, schemaSlug),
	latestActivityAt,
	state: "in_progress",
	nextUp: includeResult(nextUp === null ? [] : [nextUp]),
});

export const decodeRecipe = <Success>(
	recipe: { decode: Recipe<Success, AppSchema>["decode"] },
	data: Readonly<Record<string, unknown>>,
) => Result.getOrThrow(recipe.decode({ data }));
