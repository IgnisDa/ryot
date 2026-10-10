import { describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/client-sdk/effect";
import { createTestRyotClock } from "@ryot-app/client-sdk/testing";

import { loadFitnessPresentations } from "./entity-presentation";
import { loadWorkoutPresentations } from "./workout-presentation";

const reference = (entityId: string, entitySchemaSlug: string, name: string) => ({
	name,
	entityId,
	entitySchemaSlug,
	ownerPluginId: "fitness",
	populationStatus: "ready" as const,
	translationStatus: "ready" as const,
});

const rows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

describe("fitness presentation loaders", () => {
	it.live("batches one schema and reuses fitness preparation with managed assets", () =>
		Effect.gen(function* () {
			const documents: unknown[] = [];
			const clock = createTestRyotClock({
				query: (document) => {
					documents.push(document);
					return Effect.succeed({
						data: {
							presentations: rows([
								{
									presentationSecondary: null,
									presentationId: "exercise-1",
									presentationName: "Bench Press",
									presentationPrimary: "Strength",
									presentationCallout: "Beginner",
									presentationImage: { type: "local", key: "exercise/bench.png" },
								},
							]),
						},
					});
				},
			});
			const loaded = yield* loadFitnessPresentations({
				client: clock.client,
				references: [reference("exercise-1", "exercise", "Bench Press")],
			});

			expect(documents).toHaveLength(1);
			expect(documents[0]).toMatchObject({
				queries: { presentations: { output: { type: "rows", pagination: { limit: 100 } } } },
			});
			expect(loaded["exercise-1"]).toMatchObject({
				name: "Bench Press",
				primary: "Strength",
				batchAssets: [{ type: "local", key: "exercise/bench.png" }],
			});
			yield* Effect.promise(() => clock.dispose());
		}),
	);

	it.live("loads workouts with the shared nested set include and grouping", () =>
		Effect.gen(function* () {
			const documents: unknown[] = [];
			const clock = createTestRyotClock({
				query: (document) => {
					documents.push(document);
					return Effect.succeed({
						data: {
							presentations: rows([
								{
									presentationId: "workout-1",
									presentationName: "Push day",
									presentationExerciseNotes: null,
									presentationEndedAt: "2026-09-07T09:00:00.000Z",
									presentationStartedAt: "2026-09-07T08:00:00.000Z",
									presentationSets: rows([
										{
											reps: 8,
											weight: 60,
											id: "set-1",
											setOrder: 0,
											duration: null,
											distance: null,
											exerciseOrder: 0,
											exerciseId: "exercise-1",
											exerciseName: "Bench Press",
										},
									]),
								},
							]),
						},
					});
				},
			});
			const loaded = yield* loadWorkoutPresentations({
				client: clock.client,
				references: [reference("workout-1", "workout", "Push day")],
			});

			expect(documents[0]).toMatchObject({
				queries: {
					presentations: {
						output: { include: [expect.objectContaining({ limit: 100, key: "presentationSets" })] },
					},
				},
			});
			expect(loaded["workout-1"]?.exercises).toEqual([
				expect.objectContaining({
					id: "exercise-1",
					name: "Bench Press",
					sets: [expect.objectContaining({ reps: 8, weight: 60 })],
				}),
			]);
			yield* Effect.promise(() => clock.dispose());
		}),
	);
});
