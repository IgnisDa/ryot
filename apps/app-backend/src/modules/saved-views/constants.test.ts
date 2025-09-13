import { describe, expect, it } from "bun:test";
import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
	createEventAggregateExpression,
	createTransformExpression,
} from "@ryot/ts-utils";
import { createDefaultDisplayConfiguration } from "./constants";

describe("createDefaultDisplayConfiguration", () => {
	it("uses average user rating for built-in media card callouts", () => {
		const displayConfiguration = createDefaultDisplayConfiguration("show");

		expect(displayConfiguration.grid.calloutProperty).toEqual(
			createEventAggregateExpression("review", ["rating"], "avg"),
		);
		expect(displayConfiguration.list.calloutProperty).toEqual(
			createEventAggregateExpression("review", ["rating"], "avg"),
		);
	});

	it("builds exercise defaults from exercise properties instead of media fields", () => {
		const displayConfiguration = createDefaultDisplayConfiguration("exercise");

		expect(displayConfiguration.grid.calloutProperty).toEqual(
			createTransformExpression(
				"titleCase",
				createEntityPropertyExpression("exercise", "level"),
			),
		);
		expect(displayConfiguration.grid.primarySubtitleProperty).toEqual(
			createTransformExpression(
				"titleCase",
				createEntityPropertyExpression("exercise", "lot"),
			),
		);
		expect(displayConfiguration.grid.secondarySubtitleProperty).toEqual(
			createTransformExpression(
				"titleCase",
				createEntityPropertyExpression("exercise", "equipment"),
			),
		);
		expect(displayConfiguration.table.columns).toEqual([
			{
				label: "Name",
				expression: createEntityColumnExpression("exercise", "name"),
			},
			{
				label: "Level",
				expression: createTransformExpression(
					"titleCase",
					createEntityPropertyExpression("exercise", "level"),
				),
			},
			{
				label: "Equipment",
				expression: createTransformExpression(
					"titleCase",
					createEntityPropertyExpression("exercise", "equipment"),
				),
			},
		]);
	});
});
