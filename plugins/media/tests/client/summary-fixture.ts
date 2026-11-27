import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Result } from "@ryot-app/plugin-client-sdk/effect";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";

import type { MediaImage } from "../../shared/media-image";
import { rowsResult } from "./query-result-fixture";

const singleRow = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 1, hasMore: false, nextCursor: null });

export const decodeMediaSummaryResult = <Data>(
	recipe: { decode: Recipe<Data, AppSchema>["decode"] },
	input: {
		readonly summary: readonly Record<string, unknown>[];
		readonly requested: readonly Record<string, unknown>[];
	},
) =>
	Result.getOrThrow(
		recipe.decode({
			data: { summary: singleRow(input.summary), requested: singleRow(input.requested) },
		}),
	);

export const artworkSummaryFixture = (
	images: readonly MediaImage[],
	purpose: MediaImage["purpose"] = "cover",
) => ({
	imageCount: images.length,
	firstPreviewImage: images[0] ?? null,
	secondPreviewImage: images[1] ?? null,
	image: images.find((image) => image.purpose === purpose) ?? images[0] ?? null,
	backdropPreviewImage: images.find((image) => image.purpose === "backdrop") ?? null,
});
