import { describe, expect, it } from "bun:test";
import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
} from "@ryot/ts-utils";
import { createDefaultDisplayConfiguration } from "./constants";

describe("createDefaultDisplayConfiguration", () => {
	it("builds exercise defaults from exercise properties instead of media fields", () => {
		const displayConfiguration = createDefaultDisplayConfiguration("exercise");

		expect(displayConfiguration.grid.calloutProperty).toEqual(
			createEntityPropertyExpression("exercise", "level"),
		);
		expect(displayConfiguration.grid.primarySubtitleProperty).toEqual(
			createEntityPropertyExpression("exercise", "lot"),
		);
		expect(displayConfiguration.grid.secondarySubtitleProperty).toEqual(
			createEntityPropertyExpression("exercise", "equipment"),
		);
		expect(displayConfiguration.table.columns).toEqual([
			{
				label: "Name",
				expression: createEntityColumnExpression("exercise", "name"),
			},
			{
				label: "Level",
				expression: createEntityPropertyExpression("exercise", "level"),
			},
			{
				label: "Equipment",
				expression: createEntityPropertyExpression("exercise", "equipment"),
			},
		]);
	});
});
