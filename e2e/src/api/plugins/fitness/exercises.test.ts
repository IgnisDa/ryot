import {
	builtinSavedViewReference,
	definitionOwner,
} from "@ryot-app/contract/modules/plugins/references";
import { exerciseListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	executeRyotQL,
	executeRyotQLRecipe,
	getSavedView,
	listEventsForEntity,
	listSavedViews,
	mergeEntityUserData,
	requireRows,
	requireRyotQLText,
	requireRyotQLValue,
} from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	findFitnessEntitySchema,
	saveWorkoutData,
	workoutData,
	workoutOccurrence,
	workoutSet,
} from "~/fixtures/plugins/fitness";
import {
	assertCondition,
	assertPresent,
	assertTaggedError,
	requirePresent,
} from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { nowIso } from "~/support/time";

describe("Exercises E2E", () => {
	it.live("links the built-in exercise schema to the fitness plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginId, schema: exerciseSchema } = yield* findFitnessEntitySchema(
				client,
				"exercise",
			);

			assertPresent(exerciseSchema, "Fitness exercise schema missing");
			expect(exerciseSchema.name).toBe("Exercise");
			expect(exerciseSchema.slug).toBe("exercise");
			expect(exerciseSchema.icon).toBe("zap");
			expect(exerciseSchema.isBuiltin).toBe(true);
			expect(exerciseSchema.pluginId).toBe(pluginId);
			expect(
				exerciseSchema.providers.find(
					({ providerSlug }) => providerSlug === "exercise.free-exercise-db",
				),
			).toMatchObject({ name: "Free Exercise DB", providerId: expect.any(String) });
			expect(exerciseSchema.propertiesSchema.fields.images).toMatchObject({
				type: "array",
				label: "Images",
			});
			expect(exerciseSchema.propertiesSchema.fields.videos).toMatchObject({
				type: "array",
				label: "Videos",
			});
			expect(exerciseSchema.propertiesSchema.fields).not.toHaveProperty("source");
		}),
	);

	it.live("creates the built-in All Exercises saved view with exercise defaults", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginId } = yield* findFitnessEntitySchema(client, "exercise");
			const views = yield* listSavedViews(client, { pluginId });
			const allExercisesView = views.find((view) => view.name === "All Exercises");
			assertPresent(allExercisesView, "Expected the built-in All Exercises saved view");
			const dataSources = requirePresent(
				allExercisesView.dataSources,
				"All Exercises saved view has no data sources",
			);
			const savedViewSource = dataSources.queries.savedView;
			assertPresent(savedViewSource, "Expected the All Exercises named source");
			assertCondition(
				savedViewSource.output.type === "rows",
				"Expected the All Exercises named source to use rows output",
			);

			expect(allExercisesView).toMatchObject({
				isBuiltin: true,
				name: "All Exercises",
				renderer: { kind: "kernel", name: "entity-browser" },
				reference: builtinSavedViewReference(pluginId, "all-exercises"),
				settings: {
					pageSize: 20,
					defaultLayout: "grid",
					searchFields: ["name"],
					sourceName: "savedView",
					layouts: ["grid", "list", "table"],
					summary: { image: "image", subtitle: { field: "level", displayKind: "text" } },
					tableColumns: [
						{ label: "Name", field: "name" },
						{ label: "Level", field: "level" },
					],
					subject: {
						entityAlias: "entity",
						schemas: [{ slug: "exercise", owner: definitionOwner(pluginId) }],
					},
					addAction: {
						type: "provider-search",
						schema: { slug: "exercise", owner: definitionOwner(pluginId) },
					},
				},
			});
			expect(savedViewSource.output.fields).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						key: "entityId",
						expr: { field: "id", type: "column", tableAlias: "entity" },
					}),
					expect.objectContaining({
						key: "ownerPluginId",
						expr: { type: "column", tableAlias: "entity", field: "entitySchemaPluginId" },
					}),
					expect.objectContaining({
						key: "entitySchemaSlug",
						expr: { type: "column", tableAlias: "entity", field: "entitySchemaSlug" },
					}),
				]),
			);
			expect(savedViewSource.where).toMatchObject({
				type: "and",
				predicates: expect.arrayContaining([
					expect.objectContaining({
						type: "and",
						predicates: expect.arrayContaining([
							expect.objectContaining({
								right: { type: "literal", value: "exercise" },
								left: { type: "column", tableAlias: "entity", field: "entitySchemaSlug" },
							}),
							expect.objectContaining({
								right: { type: "pluginId", reference: { pluginId, kind: "local" } },
								left: { type: "column", tableAlias: "entity", field: "entitySchemaPluginId" },
							}),
						]),
					}),
					expect.objectContaining({
						type: "exists",
						query: expect.objectContaining({
							where: expect.objectContaining({
								predicates: expect.arrayContaining([
									expect.objectContaining({
										right: { type: "literal", value: "in-fitness-library" },
									}),
									expect.objectContaining({ right: { type: "literal", value: "fitness-library" } }),
								]),
							}),
						}),
					}),
				]),
			});
			expect(
				savedViewSource.output.fields.map((selection) => "key" in selection && selection.key),
			).toEqual([
				"entityId",
				"image",
				"name",
				"level",
				"ownerPluginId",
				"entitySchemaSlug",
				"presentationId",
				"presentationName",
				"presentationPrimary",
				"presentationCallout",
				"presentationSecondary",
				"presentationImage",
				"presentationLatestValue",
				"presentationLatestAt",
				"levelValue",
				"forceValue",
				"mechanicValue",
				"kindValue",
			]);
		}),
	);

	it.live(
		"lists created exercises in the built-in All Exercises view through fitness library membership",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { pluginId } = yield* findFitnessEntitySchema(client, "exercise");
				const exerciseName = `Listed Exercise ${crypto.randomUUID()}`;
				yield* createExerciseEntityFixture(client, { name: exerciseName, kind: "reps_and_weight" });
				const exercise = requirePresent(
					(yield* executeRyotQLRecipe(
						client,
						exerciseListRecipe({
							limit: 1,
							name: exerciseName,
							reference: { pluginId, kind: "local" },
						}),
					)).items[0],
					"Expected the created exercise in the exercise list",
				);

				expect(exercise.name).toBe(exerciseName);
				expect(exercise.image).toEqual({ type: "remote", url: "https://example.com/exercise.jpg" });
				expect(exercise.level).toBe("beginner");
				expect(exercise.kind).toBe("reps_and_weight");
				expect(exercise.equipment).toEqual([]);

				const savedView = yield* getSavedView(client, {
					pluginId,
					kind: "plugin",
					slug: "all-exercises",
				});
				const dataSources = requirePresent(
					savedView.dataSources,
					"All Exercises saved view has no data sources",
				);
				const sourceName = savedView.settings["sourceName"];
				assertCondition(typeof sourceName === "string", "Expected a named saved-view source");
				const savedViewResult = requireRows(
					(yield* executeRyotQL(client, dataSources)).data[sourceName],
					sourceName,
				);
				const savedViewExercise = savedViewResult.items.find(
					(item) => requireRyotQLValue(item, "name") === exerciseName,
				);
				expect(savedViewExercise).toBeDefined();
			}),
	);

	it.live("sorts All Exercises by workout sessions and then name", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginId } = yield* findFitnessEntitySchema(client, "exercise");
			const { exerciseId: alphaExerciseId } = yield* createExerciseEntityFixture(client, {
				name: "Alpha",
			});
			const { exerciseId: betaExerciseId } = yield* createExerciseEntityFixture(client, {
				name: "Beta",
			});
			const { exerciseId: zuluExerciseId } = yield* createExerciseEntityFixture(client, {
				name: "Zulu",
			});
			const alphaWorkout = yield* saveWorkoutData(
				client,
				workoutData({
					occurrences: [
						workoutOccurrence(
							alphaExerciseId,
							[10, 8, 6].map((reps) => workoutSet({ measurements: { reps, weight: 50 } })),
						),
					],
				}),
			);
			assertCondition(alphaWorkout.kind === "saved", "Expected the Alpha workout to save");
			expect(alphaWorkout.sets).toHaveLength(3);
			const betaWorkout = yield* saveWorkoutData(
				client,
				workoutData({
					occurrences: [
						workoutOccurrence(betaExerciseId, [
							workoutSet({ measurements: { reps: 10, weight: 50 } }),
						]),
					],
				}),
			);
			assertCondition(betaWorkout.kind === "saved", "Expected the Beta workout to save");
			expect(betaWorkout.sets).toHaveLength(1);
			const zuluFirstWorkout = yield* saveWorkoutData(
				client,
				workoutData({
					occurrences: [
						workoutOccurrence(zuluExerciseId, [
							workoutSet({ measurements: { reps: 10, weight: 50 } }),
						]),
					],
				}),
			);
			assertCondition(zuluFirstWorkout.kind === "saved", "Expected the first Zulu workout to save");
			expect(zuluFirstWorkout.sets).toHaveLength(1);
			const zuluSecondWorkout = yield* saveWorkoutData(
				client,
				workoutData({
					occurrences: [
						workoutOccurrence(zuluExerciseId, [
							workoutSet({ measurements: { reps: 8, weight: 50 } }),
						]),
					],
				}),
			);
			assertCondition(
				zuluSecondWorkout.kind === "saved",
				"Expected the second Zulu workout to save",
			);
			expect(zuluSecondWorkout.sets).toHaveLength(1);

			const savedView = yield* getSavedView(client, {
				pluginId,
				kind: "plugin",
				slug: "all-exercises",
			});
			const dataSources = requirePresent(
				savedView.dataSources,
				"All Exercises saved view has no data sources",
			);
			const sourceName = savedView.settings["sourceName"];
			assertCondition(typeof sourceName === "string", "Expected a named saved-view source");
			const result = requireRows(
				(yield* executeRyotQL(client, dataSources)).data[sourceName],
				sourceName,
			);

			expect(result.items.map((item) => requireRyotQLText(item, "entityId"))).toEqual([
				zuluExerciseId,
				alphaExerciseId,
				betaExerciseId,
			]);
		}),
	);

	it.live("merges workout-set events between exercises with the same kind", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { exerciseId: sourceId } = yield* createExerciseEntityFixture(client, {
				kind: "reps",
				name: "Source Exercise",
			});
			const { exerciseId: targetId } = yield* createExerciseEntityFixture(client, {
				kind: "reps",
				name: "Target Exercise",
			});
			const workout = yield* saveWorkoutData(
				client,
				workoutData({
					occurrences: [
						workoutOccurrence(sourceId, [
							workoutSet({ exerciseKind: "reps", measurements: { reps: 5 } }),
						]),
					],
				}),
			);

			assertCondition(workout.kind === "saved", "Expected the source workout to save");
			expect(workout.sets).toHaveLength(1);

			const result = yield* mergeEntityUserData(client, {
				mergeFrom: sourceId,
				mergeInto: targetId,
			});
			const sourceEvents = yield* listEventsForEntity(client, sourceId, undefined, 100);
			const targetEvents = yield* listEventsForEntity(client, targetId, undefined, 100);

			expect(result.movedEventsCount).toBe(2);
			expect(sourceEvents).toHaveLength(0);
			expect(targetEvents).toHaveLength(2);
			const targetOccurrence = requirePresent(
				targetEvents.find(({ eventSchemaSlug }) => eventSchemaSlug === "workout-exercise"),
				"Expected the merged workout exercise anchor",
			);
			const targetSet = requirePresent(
				targetEvents.find(({ eventSchemaSlug }) => eventSchemaSlug === "workout-set"),
				"Expected the merged workout set",
			);
			expect(targetOccurrence).toMatchObject({
				sessionEntityId: workout.entityId,
				properties: { exerciseOrder: 0, exerciseKind: "reps" },
			});
			expect(targetSet).toMatchObject({
				sessionEntityId: workout.entityId,
				properties: { reps: 5, setOrder: 0, exerciseOrder: 0, exerciseKind: "reps" },
			});
		}),
	);

	it.live("rejects merging exercises with different kinds", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: exerciseSchema } = yield* findFitnessEntitySchema(client, "exercise");
			const source = yield* createEntity(client, {
				properties: { kind: "reps" },
				name: "Source Reps Exercise",
				entitySchema: exerciseSchema.reference,
			});
			const target = yield* createEntity(client, {
				name: "Target Duration Exercise",
				properties: { kind: "duration" },
				entitySchema: exerciseSchema.reference,
			});
			const payload = {
				mergeFrom: source.id,
				mergeInto: target.id,
				submittedAt: nowIso(),
				idempotencyKey: crypto.randomUUID(),
			};

			const error = yield* Effect.flip(
				client.call((c) => c.entityUserData.mergeEntityUserData({ payload })),
			);

			assertTaggedError(error, "EntityUserDataBadRequest");
			expect(error.reason).toEqual({ property: "kind", code: "identity-property-mismatch" });
		}),
	);
});
