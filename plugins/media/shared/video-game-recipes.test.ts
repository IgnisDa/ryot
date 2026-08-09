import type { PreparedRecipe } from "@ryot-app/plugin-kit/ryotql";
import { describe, expect, it } from "vitest";

import {
	videoGameActivityRecipe,
	videoGamePresentationRecipe,
	videoGameSummaryRecipe,
} from "./video-game-recipes";

const SUMMARY_RECIPE = videoGameSummaryRecipe({ collectionLimit: 6, entityId: "video-game-1" });

const TOTALS = videoGameActivityRecipe({
	eventLimit: 60,
	entityId: "video-game-1",
	collectionEventLimit: 60,
});

const rowFields = (recipe: PreparedRecipe<unknown>, name: string) => {
	const query = recipe.document.queries[name];
	if (query?.output.type !== "rows") {
		throw new Error(`Expected the ${name} rows query`);
	}
	return query.output.fields;
};

const fieldExpr = (recipe: PreparedRecipe<unknown>, name: string, key: string) => {
	const field = rowFields(recipe, name).find((entry) => "key" in entry && entry.key === key);
	if (field === undefined || !("expr" in field)) {
		throw new Error(`Expected the ${key} field`);
	}
	return field.expr;
};

const keys = (recipe: PreparedRecipe<unknown>, name: string) =>
	rowFields(recipe, name).map((field) => ("key" in field ? field.key : null));

describe("media video game query recipes", () => {
	it("selects the time to beat and platform releases the video game schema declares", () => {
		expect(keys(SUMMARY_RECIPE, "summary").slice(-3)).toEqual([
			"progressPercent",
			"timeToBeat",
			"platformReleases",
		]);
	});

	it("reaches into the nested time to beat for the presentation row", () => {
		const presentation = videoGamePresentationRecipe(["video-game-1"]);

		expect(keys(presentation, "rows")).toContain("timeToBeatNormally");
		expect(fieldExpr(presentation, "rows", "timeToBeatNormally")).toMatchObject({
			type: "cast",
			target: "number",
			expr: { type: "jsonPath", path: ["timeToBeat", "normally"] },
		});
	});

	it("measures playtime from recorded time spent and never from the community estimate", () => {
		const amount = fieldExpr(TOTALS, "totals", "consumedAmount");
		const unknown = fieldExpr(TOTALS, "totals", "unknownAmountCount");

		expect(JSON.stringify(amount)).toContain("timeSpent");
		expect(JSON.stringify(amount)).not.toContain("timeToBeat");
		expect(JSON.stringify(unknown)).toContain("timeSpent");
		expect(JSON.stringify(unknown)).not.toContain("timeToBeat");
	});
});
