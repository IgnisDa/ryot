import type { PreparedRecipe } from "@ryot-app/plugin-kit/ryotql";
import { describe, expect, it } from "vitest";

import { musicActivityRecipe, musicPresentationRecipe, musicSummaryRecipe } from "./music-recipes";

const rowFields = (recipe: PreparedRecipe<unknown>, name: string) => {
	const query = recipe.document.queries[name];
	if (query?.output.type !== "rows") {
		throw new Error(`Expected the ${name} rows query`);
	}
	return query.output.fields;
};

const keys = (recipe: PreparedRecipe<unknown>, name: string) =>
	rowFields(recipe, name).map((field) => ("key" in field ? field.key : null));

describe("media music query recipes", () => {
	it("selects only the duration and various-artists fields the music schema declares", () => {
		const summary = keys(
			musicSummaryRecipe({ collectionLimit: 6, entityId: "music-1" }),
			"summary",
		);

		expect(summary.slice(-3)).toEqual(["progressPercent", "duration", "byVariousArtists"]);
		expect(summary).not.toContain("watchProviders");
		expect(keys(musicPresentationRecipe(["music-1"]), "rows")).toContain("duration");
	});

	it("converts the duration to minutes before summing listened time", () => {
		const amount = rowFields(
			musicActivityRecipe({ eventLimit: 60, entityId: "music-1", collectionEventLimit: 60 }),
			"totals",
		).find((field) => "key" in field && field.key === "consumedAmount");
		if (amount === undefined || !("expr" in amount)) {
			throw new Error("Expected the consumed amount aggregate");
		}

		expect(amount.expr).toMatchObject({
			type: "aggregate",
			aggregation: {
				function: "sum",
				expr: {
					whenTrue: {
						type: "coalesce",
						values: [{}, { type: "arithmetic", operator: "divide", right: { value: 60 } }],
					},
				},
			},
		});
		expect(JSON.stringify(amount.expr)).toContain("duration");
	});
});
