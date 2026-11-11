import { describe, expect } from "bun:test";

import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { workoutCardsRecipe, workoutWeeksRecipe } from "../../shared/workout-list-recipes";
import { bindWorkoutRecipe } from "../../tests/workout-recipes.test-support";
import { workoutFilterFields } from "./filters";

const serialize = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const reference = { kind: "local", pluginId: PluginId.make("fitness-owner") } as const;
describe("compileWorkoutFilter", () => {
	it.effect(
		"needs no predicate without a filter",
		() =>
			Effect.sync(() => {
				expect(
					bindWorkoutRecipe(workoutCardsRecipe({ reference }), {}).document.queries["workouts"],
				).toBeDefined();
			}),
		testTimeout,
	);

	it.effect(
		"compiles started, count and template rules into the cards and weeks queries",
		() =>
			Effect.gen(function* () {
				const filter = {
					type: "and",
					filters: [
						{ days: 7, field: "startedAt", operator: "withinLastDays" },
						{ value: 3, operator: "gte", field: "exerciseCount" },
						{ operator: "anyOf", field: "template", values: ["template-1"] },
					],
				} as const;
				const cards = bindWorkoutRecipe(
					workoutCardsRecipe({ reference }),
					{ search: "" },
					filter,
					reference,
				);
				const weeks = bindWorkoutRecipe(
					workoutWeeksRecipe({ reference }),
					{ search: "", endAt: "2026-02-01T00:00:00Z", startAt: "2026-01-01T00:00:00Z" },
					filter,
					reference,
				);
				const text = yield* serialize([cards.document, weeks.document]);
				expect(text).toContain("template-1");
				expect(text).toContain("workout-to-workout-template");
				expect(text).toContain("browseWorkoutTotals");
			}),
		testTimeout,
	);

	it.effect(
		"fails for a field the workouts view does not declare",
		() =>
			Effect.sync(() => {
				expect(() =>
					bindWorkoutRecipe(
						workoutCardsRecipe({ reference }),
						{},
						{ field: "volume", operator: "empty" },
						reference,
					),
				).toThrow("Unknown filter field 'volume'");
			}),
		testTimeout,
	);

	it.effect(
		"compiles an exercises rule against workout sets of exercise entities",
		() =>
			Effect.gen(function* () {
				const filter = { operator: "anyOf", field: "exercises", values: ["exercise-1"] } as const;
				const cards = bindWorkoutRecipe(
					workoutCardsRecipe({ reference }),
					{ search: "" },
					filter,
					reference,
				);
				const text = yield* serialize(cards.document);
				expect(text).toContain("exercise-1");
				expect(text).toContain("workout-set");
				expect(text).toContain("sessionEntityId");
			}),
		testTimeout,
	);
});

describe("workoutFilterFields", () => {
	it("declares unique keys and labels", () => {
		const fields = workoutFilterFields(reference);
		expect(new Set(fields.map(({ key }) => key)).size).toBe(fields.length);
		expect(new Set(fields.map(({ label }) => label)).size).toBe(fields.length);
	});
});
