import { Result } from "@ryot-app/client-sdk/effect";
import type { PreparedRecipe } from "@ryot-app/client-sdk/ryotql";

import { rowsResult } from "../query-result-fixture";

const presentationRowDefaults = {
	images: null,
	id: "media-1",
	name: "Fixture",
	publishDate: null,
	publishYear: null,
	progressPercent: 42,
	state: "in_progress",
	productionStatus: null,
	populationStatus: "ready",
	translationStatus: "none",
};

export const decodeFlatPresentation = <Presentation>(
	recipes: {
		readonly presentationRecipe: (
			entityIds: readonly string[],
		) => PreparedRecipe<readonly Presentation[]>;
	},
	row: Record<string, unknown>,
) => {
	const [decoded] = Result.getOrThrow(
		recipes
			.presentationRecipe(["media-1"])
			.decode({
				data: {
					rows: rowsResult([{ ...presentationRowDefaults, ...row }], {
						limit: 100,
						hasMore: false,
						nextCursor: null,
					}),
				},
			}),
	);
	if (decoded === undefined) {
		throw new Error("Expected decoded presentation data");
	}
	return { ...decoded, batchAssets: [] };
};
