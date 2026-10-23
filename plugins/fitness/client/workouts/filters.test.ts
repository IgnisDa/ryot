import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId } from "@ryot-app/plugin-client-sdk/plugin";

import { workoutCardsRecipe, workoutWeeksRecipe } from "../../shared/workout-list-recipes";
import { compileWorkoutFilter, workoutFilterFields } from "./filters";

const serialize = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const reference = { kind: "local", pluginId: PluginId.make("fitness-owner") } as const;
const compile = (filter: Parameters<typeof compileWorkoutFilter>[0]["filter"]) =>
	compileWorkoutFilter({ filter, reference, target: "list" });

describe("compileWorkoutFilter", () => {
	it.effect("needs no predicate without a filter", () =>
		Effect.gen(function* () {
			expect(yield* compile(null)).toBeUndefined();
		}),
	);

	it.effect("compiles started, count and template rules into the cards and weeks queries", () =>
		Effect.gen(function* () {
			const filter = {
				type: "and",
				filters: [
					{ days: 7, field: "startedAt", operator: "withinLastDays" },
					{ value: 3, operator: "gte", field: "exerciseCount" },
					{ operator: "anyOf", field: "template", values: ["template-1"] },
				],
			} as const;
			const cards = workoutCardsRecipe({ reference, search: "", filter: yield* compile(filter) });
			const weeks = workoutWeeksRecipe({
				reference,
				search: "",
				timeZone: "UTC",
				endAt: "2026-10-18T00:00:00.000Z",
				startAt: "2026-09-18T00:00:00.000Z",
				filter: yield* compileWorkoutFilter({ filter, reference, target: "weeks" }),
			});
			const text = serialize([cards.document, weeks.document]);
			expect(text).toContain("template-1");
			expect(text).toContain("workout-to-workout-template");
			expect(text).toContain("filterTotalsSet");
		}),
	);

	it.effect("fails for a field the workouts view does not declare", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(compile({ field: "volume", operator: "empty" }));
			expect(error.message).toBe("Unknown filter field 'volume'");
		}),
	);

	it.effect("compiles an exercises rule against workout sets of exercise entities", () =>
		Effect.gen(function* () {
			const filter = { operator: "anyOf", field: "exercises", values: ["exercise-1"] } as const;
			const cards = workoutCardsRecipe({ reference, search: "", filter: yield* compile(filter) });
			const text = serialize(cards.document);
			expect(text).toContain("exercise-1");
			expect(text).toContain("workout-set");
			expect(text).toContain("sessionEntityId");
		}),
	);
});

describe("workoutFilterFields", () => {
	it("declares unique keys and labels", () => {
		const fields = workoutFilterFields(reference);
		expect(new Set(fields.map(({ key }) => key)).size).toBe(fields.length);
		expect(new Set(fields.map(({ label }) => label)).size).toBe(fields.length);
	});
});
