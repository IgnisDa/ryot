import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { historicalFitnessRankingRecipe } from "@ryot-app/fitness-plugin/analytics-recipes";
import {
	exerciseEquipmentRecipe,
	exerciseTargetsRecipe,
} from "@ryot-app/fitness-plugin/taxonomy-recipes";
import { Clock, Effect, Result } from "effect";

import { type Client, createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { getEntity } from "~/fixtures/kernel/entities";
import { listEventsForEntity, waitForCreateEvents } from "~/fixtures/kernel/events";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import {
	createWorkoutEvidenceTaxonomy,
	findWorkoutExerciseEventSchema,
	readWorkoutExerciseEvidence,
} from "~/fixtures/plugins/fitness/analytics-evidence";
import { createExerciseEntityFixture } from "~/fixtures/plugins/fitness/exercises";
import {
	deleteWorkout,
	editTarget,
	keepSet,
	loadWorkoutBaseline,
	saveWorkoutData,
	workoutData,
	workoutEditorTimes,
	workoutOccurrence,
	workoutReference,
	workoutSet,
} from "~/fixtures/plugins/fitness/workout-editor";
import {
	createWorkoutEntityFixture,
	findWorkoutSetEventSchema,
} from "~/fixtures/plugins/fitness/workouts";
import { assertCondition, assertTaggedError, requirePresent } from "~/support/assertions";
import { expect, it } from "~/support/effect-test";
import { nowIso } from "~/support/time";

type EvidenceTaxonomy = Effect.Success<ReturnType<typeof createWorkoutEvidenceTaxonomy>>;
type WorkoutExerciseEvidenceProperties = Effect.Success<
	ReturnType<typeof readWorkoutExerciseEvidence>
>[number]["properties"];

const byExerciseOrder = <T extends { readonly properties: { readonly exerciseOrder: number } }>(
	evidence: readonly T[],
) =>
	[...evidence].sort(
		(left, right) => left.properties.exerciseOrder - right.properties.exerciseOrder,
	);

const expectedEvidenceProperties = (taxonomy: EvidenceTaxonomy, exerciseOrder: number) => ({
	exerciseOrder,
	provenance: "recorded",
	exerciseKind: "reps_and_weight",
	equipment: [...taxonomy.equipment].sort((left, right) => left.localeCompare(right)),
	targets: [...taxonomy.targets]
		.map(({ role, entityId }) => ({ role, entityId }))
		.sort((left, right) => left.entityId.localeCompare(right.entityId)),
});

const orderedEvidenceProperties = (
	properties: WorkoutExerciseEvidenceProperties,
): WorkoutExerciseEvidenceProperties => ({
	...properties,
	equipment: [...properties.equipment].sort((left, right) => left.localeCompare(right)),
	targets: [...properties.targets].sort((left, right) =>
		left.entityId.localeCompare(right.entityId),
	),
});

const requireRanking = <T extends { readonly id: string }>(items: readonly T[], entityId: string) =>
	requirePresent(
		items.find(({ id }) => id === entityId),
		`Expected an analytics ranking row for ${entityId}`,
	);

const readRankings = (
	client: Client,
	reference: Effect.Success<ReturnType<typeof workoutReference>>,
	kind: "targets" | "equipment" | "exercises",
) =>
	Effect.gen(function* () {
		const now = yield* Clock.currentTimeMillis;
		const { items } = yield* executeRyotQLRecipe(
			client,
			historicalFitnessRankingRecipe({
				now,
				kind,
				reference,
				timeZone: TimeZone.make("UTC"),
				selection: { grouping: "auto", comparison: "none", range: { kind: "all-time" } },
			}),
		);
		return items;
	});

it.live("rejects direct orphan sets and empty occurrence evidence without partial writes", () =>
	Effect.gen(function* () {
		const { client } = yield* createAuthenticatedClient();
		const { exercise, exerciseId } = yield* createExerciseEntityFixture(client);
		const { workoutId } = yield* createWorkoutEntityFixture(client);
		const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
		const workoutExerciseEventSchema = yield* findWorkoutExerciseEventSchema(client);
		const orphan = yield* client.call((c) =>
			c.events.create({
				payload: [
					{
						entityId: exerciseId,
						sessionEntityId: workoutId,
						eventSchemaSlug: workoutSetEventSchema.id,
						occurredAt: workoutEditorTimes.setOccurredAt,
						properties: { reps: 5, weight: 10, setOrder: 0, exerciseOrder: 0 },
					},
				],
			}),
		);
		expect(yield* waitForCreateEvents(client, orphan)).toMatchObject({
			count: 0,
			failure: { index: 0, reason: { code: "mutation-conflict" } },
			outcomes: [{ index: 0, status: "failed", reason: { code: "mutation-conflict" } }],
		});
		const reference = yield* workoutReference(client);
		const emptyOccurrence = yield* client.call((c) =>
			c.events.create({
				payload: [
					{
						entityId: exerciseId,
						sessionEntityId: workoutId,
						properties: { exerciseOrder: 0 },
						occurredAt: workoutEditorTimes.startedAt,
						eventSchemaSlug: workoutExerciseEventSchema.id,
					},
				],
			}),
		);
		expect(yield* waitForCreateEvents(client, emptyOccurrence)).toMatchObject({
			count: 0,
			failure: { index: 0, reason: { code: "mutation-conflict" } },
			outcomes: [{ index: 0, status: "failed", reason: { code: "mutation-conflict" } }],
		});
		expect(yield* listEventsForEntity(client, exerciseId, undefined, 100)).toEqual([]);
		const exerciseRankings = yield* readRankings(client, reference, "exercises");
		expect(exerciseRankings).toHaveLength(1);
		expect(requireRanking(exerciseRankings, exerciseId)).toMatchObject({
			sets: 0,
			workouts: 0,
			id: exerciseId,
			weightedSets: null,
			name: exercise.name,
			exerciseOccurrences: 0,
		});
	}),
);

it.live("rejects direct occurrence rebinding and last-set or anchor deletion", () =>
	Effect.gen(function* () {
		const { client } = yield* createAuthenticatedClient();
		const { exerciseId } = yield* createExerciseEntityFixture(client);
		const saved = yield* saveWorkoutData(
			client,
			workoutData({
				occurrences: [
					workoutOccurrence(exerciseId, [workoutSet(), workoutSet()]),
					workoutOccurrence(exerciseId, [workoutSet()]),
				],
			}),
		);
		assertCondition(saved.kind === "saved", "Expected the constrained workout to save");
		const before = yield* listEventsForEntity(client, exerciseId, undefined, 100);
		const evidence = byExerciseOrder(
			yield* readWorkoutExerciseEvidence(client, exerciseId, saved.entityId),
		);
		const firstSet = requirePresent(
			before.find(
				({ properties, eventSchemaSlug }) =>
					eventSchemaSlug === "workout-set" && properties["exerciseOrder"] === 0,
			),
			"Expected a set from the first occurrence",
		);
		const lastSet = requirePresent(
			before.find(
				({ properties, eventSchemaSlug }) =>
					eventSchemaSlug === "workout-set" && properties["exerciseOrder"] === 1,
			),
			"Expected the last set from the second occurrence",
		);
		for (const exerciseOrder of [1, 2]) {
			const rejected = yield* Effect.flip(
				client.call((c) =>
					c.events.update({
						params: { eventId: firstSet.id },
						payload: { properties: { remove: [], set: { exerciseOrder } } },
					}),
				),
			);
			assertTaggedError(rejected, "EventBadRequest");
			expect(rejected.reason).toMatchObject({ code: "mutation-conflict" });
		}
		const anchor = requirePresent(evidence[1], "Expected the second occurrence evidence");
		for (const eventId of [lastSet.id, anchor.id]) {
			const rejected = yield* Effect.flip(
				client.call((c) => c.events.delete({ params: { eventId } })),
			);
			assertTaggedError(rejected, "EventBadRequest");
			expect(rejected.reason).toMatchObject({ code: "mutation-conflict" });
		}
		expect(yield* listEventsForEntity(client, exerciseId, undefined, 100)).toEqual(before);
	}),
);

it.live("serializes concurrent direct deletions so one set and its occurrence remain", () =>
	Effect.gen(function* () {
		const { client } = yield* createAuthenticatedClient();
		const { exerciseId } = yield* createExerciseEntityFixture(client);
		const saved = yield* saveWorkoutData(
			client,
			workoutData({ occurrences: [workoutOccurrence(exerciseId, [workoutSet(), workoutSet()])] }),
		);
		assertCondition(saved.kind === "saved", "Expected the concurrent-delete workout to save");
		const originalEvidence = yield* readWorkoutExerciseEvidence(client, exerciseId, saved.entityId);
		const before = yield* loadWorkoutBaseline(client, saved.entityId);
		expect(before.baseline.sets).toHaveLength(2);
		const results = yield* Effect.forEach(
			before.baseline.sets,
			({ id: eventId }) =>
				client.call((c) => c.events.delete({ params: { eventId } })).pipe(Effect.result),
			{ concurrency: 2 },
		);
		expect(results.filter(Result.isSuccess)).toHaveLength(1);
		const failures = results.filter(Result.isFailure);
		expect(failures).toHaveLength(1);
		const rejected = requirePresent(failures[0], "Expected one deletion to fail").failure;
		assertTaggedError(rejected, "EventBadRequest");
		expect(rejected.reason).toMatchObject({ code: "mutation-conflict" });
		const remaining = yield* loadWorkoutBaseline(client, saved.entityId);
		expect(remaining.baseline.sets).toHaveLength(1);
		expect(yield* readWorkoutExerciseEvidence(client, exerciseId, saved.entityId)).toEqual(
			originalEvidence,
		);
	}),
);

it.live(
	"records repeated exercise occurrences with exact taxonomy evidence and ranking counts",
	() =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const taxonomy = yield* createWorkoutEvidenceTaxonomy(client, exerciseId, {
				equipmentCount: 2,
				targetRoles: ["primary", "secondary", "stabilizer", null],
			});
			const saved = yield* saveWorkoutData(
				client,
				workoutData({
					occurrences: [
						workoutOccurrence(exerciseId, [workoutSet()]),
						workoutOccurrence(exerciseId, [workoutSet()]),
					],
				}),
			);
			assertCondition(saved.kind === "saved", "Expected the repeated-exercise workout to save");

			const evidence = byExerciseOrder(
				yield* readWorkoutExerciseEvidence(client, exerciseId, saved.entityId),
			);
			expect(evidence).toHaveLength(2);
			expect(new Set(evidence.map(({ id }) => id)).size).toBe(2);
			expect(evidence.map(({ eventSchemaSlug }) => eventSchemaSlug)).toEqual([
				"workout-exercise",
				"workout-exercise",
			]);
			expect(evidence.map(({ occurredAt }) => occurredAt)).toEqual([
				workoutEditorTimes.startedAt,
				workoutEditorTimes.startedAt,
			]);
			expect(evidence.map(({ sessionEntityId }) => sessionEntityId)).toEqual([
				saved.entityId,
				saved.entityId,
			]);
			expect(evidence.map(({ properties }) => orderedEvidenceProperties(properties))).toEqual([
				expectedEvidenceProperties(taxonomy, 0),
				expectedEvidenceProperties(taxonomy, 1),
			]);

			const reference = yield* workoutReference(client);
			const targetRankings = yield* readRankings(client, reference, "targets");
			for (const target of taxonomy.targets) {
				const expectedWeight =
					target.role === null ? 2 : { primary: 2, secondary: 1, stabilizer: 0 }[target.role];
				expect(requireRanking(targetRankings, target.entityId)).toMatchObject({
					sets: 2,
					workouts: 1,
					exerciseOccurrences: 2,
					weightedSets: expectedWeight,
				});
			}
			const exerciseRankings = yield* readRankings(client, reference, "exercises");
			expect(requireRanking(exerciseRankings, exerciseId)).toMatchObject({
				sets: 2,
				workouts: 1,
				weightedSets: 2,
				exerciseOccurrences: 2,
			});
		}),
);

it.live("freezes prior evidence and rankings when exercise taxonomy changes", () =>
	Effect.gen(function* () {
		const { client } = yield* createAuthenticatedClient();
		const { exerciseId } = yield* createExerciseEntityFixture(client);
		const originalTaxonomy = yield* createWorkoutEvidenceTaxonomy(client, exerciseId, {
			equipmentCount: 1,
			targetRoles: ["primary"],
		});
		const originalTarget = requirePresent(
			originalTaxonomy.targets[0],
			"Expected the original target",
		);
		const originalEquipment = requirePresent(
			originalTaxonomy.equipment[0],
			"Expected the original equipment",
		);
		const oldWorkout = yield* saveWorkoutData(
			client,
			workoutData({ occurrences: [workoutOccurrence(exerciseId, [workoutSet()])] }),
		);
		assertCondition(oldWorkout.kind === "saved", "Expected the original workout to save");
		const oldEvidence = yield* readWorkoutExerciseEvidence(client, exerciseId, oldWorkout.entityId);
		const oldOccurrence = requirePresent(oldEvidence[0], "Expected old workout evidence");
		expect(oldOccurrence).toMatchObject({ occurredAt: workoutEditorTimes.startedAt });
		expect(orderedEvidenceProperties(oldOccurrence.properties)).toEqual(
			expectedEvidenceProperties(originalTaxonomy, 0),
		);
		const reference = yield* workoutReference(client);
		const targetsBeforeChange = yield* readRankings(client, reference, "targets");
		const originalTargetRank = requireRanking(targetsBeforeChange, originalTarget.entityId);
		expect(originalTargetRank).toMatchObject({
			sets: 1,
			workouts: 1,
			weightedSets: 1,
			exerciseOccurrences: 1,
		});
		const equipmentBeforeChange = yield* readRankings(client, reference, "equipment");
		const originalEquipmentRank = requireRanking(equipmentBeforeChange, originalEquipment);

		const addedTaxonomy = yield* createWorkoutEvidenceTaxonomy(client, exerciseId, {
			equipmentCount: 1,
			targetRoles: ["secondary"],
		});
		const addedTarget = requirePresent(addedTaxonomy.targets[0], "Expected the added target");
		const addedEquipment = requirePresent(
			addedTaxonomy.equipment[0],
			"Expected the added equipment",
		);
		expect(yield* readWorkoutExerciseEvidence(client, exerciseId, oldWorkout.entityId)).toEqual(
			oldEvidence,
		);
		const targetsAfterChange = yield* readRankings(client, reference, "targets");
		expect(requireRanking(targetsAfterChange, originalTarget.entityId)).toEqual(originalTargetRank);
		const equipmentAfterChange = yield* readRankings(client, reference, "equipment");
		expect(requireRanking(equipmentAfterChange, originalEquipment)).toEqual(originalEquipmentRank);

		const newStartedAt = "2026-10-02T10:00:00.000Z";
		const newWorkout = yield* saveWorkoutData(
			client,
			workoutData({
				startedAt: newStartedAt,
				occurrences: [
					workoutOccurrence(exerciseId, [
						workoutSet({ occurredAt: newStartedAt, confirmedAt: newStartedAt }),
					]),
				],
			}),
		);
		assertCondition(newWorkout.kind === "saved", "Expected the new workout to save");
		const newEvidence = yield* readWorkoutExerciseEvidence(client, exerciseId, newWorkout.entityId);
		const newOccurrence = requirePresent(newEvidence[0], "Expected new workout evidence");
		const changedTaxonomy = {
			targets: [...originalTaxonomy.targets, ...addedTaxonomy.targets],
			equipment: [...originalTaxonomy.equipment, ...addedTaxonomy.equipment],
		};
		expect(newOccurrence).toMatchObject({ occurredAt: newStartedAt });
		expect(orderedEvidenceProperties(newOccurrence.properties)).toEqual(
			expectedEvidenceProperties(changedTaxonomy, 0),
		);
		expect(orderedEvidenceProperties(oldOccurrence.properties)).toEqual(
			expectedEvidenceProperties(originalTaxonomy, 0),
		);

		const finalTargets = yield* readRankings(client, reference, "targets");
		expect(requireRanking(finalTargets, originalTarget.entityId)).toMatchObject({
			sets: 2,
			workouts: 2,
			weightedSets: 2,
			exerciseOccurrences: 2,
		});
		expect(requireRanking(finalTargets, addedTarget.entityId)).toMatchObject({
			sets: 1,
			workouts: 1,
			weightedSets: 0.5,
			exerciseOccurrences: 1,
		});
		const finalEquipment = yield* readRankings(client, reference, "equipment");
		expect(requireRanking(finalEquipment, originalEquipment)).toMatchObject({
			sets: 2,
			workouts: 2,
			weightedSets: 2,
			exerciseOccurrences: 2,
		});
		expect(requireRanking(finalEquipment, addedEquipment)).toMatchObject({
			sets: 1,
			workouts: 1,
			weightedSets: 1,
			exerciseOccurrences: 1,
		});
	}),
);

it.live(
	"retains occurrence evidence through historical reorder and edit, then removes one position",
	() =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const taxonomy = yield* createWorkoutEvidenceTaxonomy(client, exerciseId, {
				equipmentCount: 1,
				targetRoles: ["primary", "stabilizer"],
			});
			const created = yield* saveWorkoutData(
				client,
				workoutData({
					occurrences: [
						workoutOccurrence(exerciseId, [workoutSet()]),
						workoutOccurrence(exerciseId, [workoutSet()]),
					],
				}),
			);
			assertCondition(created.kind === "saved", "Expected the historical workout to save");
			const originalEvidence = byExerciseOrder(
				yield* readWorkoutExerciseEvidence(client, exerciseId, created.entityId),
			);
			const firstOccurrence = requirePresent(originalEvidence[0], "Expected the first occurrence");
			const secondOccurrence = requirePresent(
				originalEvidence[1],
				"Expected the second occurrence",
			);
			const original = yield* loadWorkoutBaseline(client, created.entityId);
			const firstSet = requirePresent(
				original.baseline.sets.find(({ properties }) => properties["exerciseOrder"] === 0),
				"Expected the first set",
			);
			const secondSet = requirePresent(
				original.baseline.sets.find(({ properties }) => properties["exerciseOrder"] === 1),
				"Expected the second set",
			);

			const reordered = yield* saveWorkoutData(
				client,
				workoutData({
					target: editTarget(original),
					name: original.baseline.entity.name,
					occurrences: [
						workoutOccurrence(exerciseId, [keepSet(secondSet)], { sourceExerciseOrder: 1 }),
						workoutOccurrence(exerciseId, [keepSet(firstSet)], { sourceExerciseOrder: 0 }),
					],
				}),
			);
			assertCondition(reordered.kind === "saved", "Expected historical reorder to save");
			const reorderedEvidence = byExerciseOrder(
				yield* readWorkoutExerciseEvidence(client, exerciseId, created.entityId),
			);
			expect(reorderedEvidence.map(({ id }) => id)).toEqual([
				secondOccurrence.id,
				firstOccurrence.id,
			]);
			expect(
				reorderedEvidence.map(({ properties }) => orderedEvidenceProperties(properties)),
			).toEqual([expectedEvidenceProperties(taxonomy, 0), expectedEvidenceProperties(taxonomy, 1)]);

			const reorderedBaseline = yield* loadWorkoutBaseline(client, created.entityId);
			const reorderedFirstSet = requirePresent(
				reorderedBaseline.baseline.sets.find(({ properties }) => properties["exerciseOrder"] === 0),
				"Expected the reordered first set",
			);
			const reorderedSecondSet = requirePresent(
				reorderedBaseline.baseline.sets.find(({ properties }) => properties["exerciseOrder"] === 1),
				"Expected the reordered second set",
			);
			expect(reorderedFirstSet.id).toBe(secondSet.id);
			expect(reorderedSecondSet.id).toBe(firstSet.id);
			const edited = yield* saveWorkoutData(
				client,
				workoutData({
					target: editTarget(reorderedBaseline),
					name: `${reorderedBaseline.baseline.entity.name} unrelated edit`,
					occurrences: [
						workoutOccurrence(exerciseId, [keepSet(reorderedFirstSet)], { sourceExerciseOrder: 0 }),
						workoutOccurrence(exerciseId, [keepSet(reorderedSecondSet)], {
							sourceExerciseOrder: 1,
						}),
					],
				}),
			);
			assertCondition(edited.kind === "saved", "Expected the unrelated historical edit to save");
			const afterUnrelatedEdit = byExerciseOrder(
				yield* readWorkoutExerciseEvidence(client, exerciseId, created.entityId),
			);
			expect(afterUnrelatedEdit.map(({ id }) => id)).toEqual(reorderedEvidence.map(({ id }) => id));
			expect(
				afterUnrelatedEdit.map(({ properties }) => ({
					targets: properties.targets,
					equipment: properties.equipment,
					provenance: properties.provenance,
					exerciseKind: properties.exerciseKind,
				})),
			).toEqual(
				reorderedEvidence.map(({ properties }) => ({
					targets: properties.targets,
					equipment: properties.equipment,
					provenance: properties.provenance,
					exerciseKind: properties.exerciseKind,
				})),
			);
			expect(
				afterUnrelatedEdit.map(({ properties }) => orderedEvidenceProperties(properties)),
			).toEqual([expectedEvidenceProperties(taxonomy, 0), expectedEvidenceProperties(taxonomy, 1)]);

			const beforeRemoval = yield* loadWorkoutBaseline(client, created.entityId);
			const retainedSet = requirePresent(
				beforeRemoval.baseline.sets.find(({ properties }) => properties["exerciseOrder"] === 0),
				"Expected a set at the retained position",
			);
			const removedOccurrence = requirePresent(
				afterUnrelatedEdit[1],
				"Expected the occurrence to remove",
			);
			const removed = yield* saveWorkoutData(
				client,
				workoutData({
					target: editTarget(beforeRemoval),
					name: beforeRemoval.baseline.entity.name,
					occurrences: [
						workoutOccurrence(exerciseId, [keepSet(retainedSet)], { sourceExerciseOrder: 0 }),
					],
				}),
			);
			assertCondition(removed.kind === "saved", "Expected position removal to save");
			const remainingEvidence = yield* readWorkoutExerciseEvidence(
				client,
				exerciseId,
				created.entityId,
			);
			expect(remainingEvidence).toHaveLength(1);
			expect(remainingEvidence[0]).toMatchObject({
				id: requirePresent(afterUnrelatedEdit[0], "Expected retained occurrence").id,
			});
			expect(
				orderedEvidenceProperties(
					requirePresent(remainingEvidence[0], "Expected retained occurrence").properties,
				),
			).toEqual(expectedEvidenceProperties(taxonomy, 0));
			expect(remainingEvidence.map(({ id }) => id)).not.toContain(removedOccurrence.id);
			const remainingBaseline = yield* loadWorkoutBaseline(client, created.entityId);
			expect(remainingBaseline.baseline.sets.map(({ id }) => id)).toEqual([retainedSet.id]);
		}),
);

it.live(
	"deleting a workout removes its evidence and sets but keeps exercise taxonomy and other records",
	() =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const taxonomy = yield* createWorkoutEvidenceTaxonomy(client, exerciseId, {
				equipmentCount: 1,
				targetRoles: ["primary"],
			});
			const deletedWorkout = yield* saveWorkoutData(
				client,
				workoutData({ occurrences: [workoutOccurrence(exerciseId, [workoutSet()])] }),
			);
			assertCondition(deletedWorkout.kind === "saved", "Expected the workout to save");
			const survivingWorkout = yield* saveWorkoutData(
				client,
				workoutData({
					startedAt: "2026-10-02T10:00:00.000Z",
					occurrences: [
						workoutOccurrence(exerciseId, [
							workoutSet({
								occurredAt: "2026-10-02T10:00:00.000Z",
								confirmedAt: "2026-10-02T10:00:00.000Z",
							}),
						]),
					],
				}),
			);
			assertCondition(survivingWorkout.kind === "saved", "Expected the surviving workout to save");
			const reference = yield* workoutReference(client);

			expect(
				yield* deleteWorkout(client, {
					submittedAt: nowIso(),
					entityId: deletedWorkout.entityId,
					submissionId: crypto.randomUUID(),
				}),
			).toEqual({ entityId: deletedWorkout.entityId });

			expect(
				yield* readWorkoutExerciseEvidence(client, exerciseId, deletedWorkout.entityId),
			).toEqual([]);
			expect(
				yield* readWorkoutExerciseEvidence(client, exerciseId, survivingWorkout.entityId),
			).toHaveLength(1);
			expect((yield* getEntity(client, exerciseId)).id).toBe(exerciseId);
			expect((yield* getEntity(client, survivingWorkout.entityId)).id).toBe(
				survivingWorkout.entityId,
			);
			const survivingBaseline = yield* loadWorkoutBaseline(client, survivingWorkout.entityId);
			expect(survivingBaseline.baseline.sets).toHaveLength(1);
			const setEvents = yield* listEventsForEntity(client, exerciseId, undefined, 100, {
				eventSchemaSlug: "workout-set",
			});
			expect(
				setEvents.filter(({ sessionEntityId }) => sessionEntityId === deletedWorkout.entityId),
			).toEqual([]);
			expect(
				setEvents.filter(({ sessionEntityId }) => sessionEntityId === survivingWorkout.entityId),
			).toHaveLength(1);

			const [targets, equipment] = yield* Effect.all([
				executeRyotQLRecipe(client, exerciseTargetsRecipe({ reference, limit: 100, exerciseId })),
				executeRyotQLRecipe(client, exerciseEquipmentRecipe({ reference, limit: 100, exerciseId })),
			]);
			expect(targets.items.map(({ id, role }) => ({ role, entityId: id }))).toEqual(
				[...taxonomy.targets].sort((left, right) => left.entityId.localeCompare(right.entityId)),
			);
			expect(equipment.items.map(({ id }) => id)).toEqual(
				[...taxonomy.equipment].sort((left, right) => left.localeCompare(right)),
			);
		}),
);
