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
			createEventAggregateExpression("review", ["properties", "rating"], "avg"),
		);
		expect(displayConfiguration.list.calloutProperty).toEqual(
			createEventAggregateExpression("review", ["properties", "rating"], "avg"),
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
				createEntityPropertyExpression("exercise", "kind"),
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

	it("builds workout defaults from workout properties instead of media fields", () => {
		const displayConfiguration = createDefaultDisplayConfiguration("workout");

		expect(displayConfiguration.grid.calloutProperty).toBeNull();
		expect(displayConfiguration.grid.primarySubtitleProperty).toEqual(
			createEntityPropertyExpression("workout", "startedAt"),
		);
		expect(displayConfiguration.grid.secondarySubtitleProperty).toEqual(
			createEntityPropertyExpression("workout", "endedAt"),
		);
		expect(displayConfiguration.table.columns).toEqual([
			{
				label: "Name",
				expression: createEntityColumnExpression("workout", "name"),
			},
			{
				label: "Started At",
				expression: createEntityPropertyExpression("workout", "startedAt"),
			},
			{
				label: "Ended At",
				expression: createEntityPropertyExpression("workout", "endedAt"),
			},
		]);
	});
});
